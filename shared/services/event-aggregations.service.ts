import { clickhouse } from "@/core/clickhouse/client";
import { EVENTS_TABLE } from "@/core/clickhouse/tables";
import { ParamBag } from "@/core/clickhouse/params";
import {
    EVENT_READ_COLUMNS,
    EVENT_READ_SETTINGS,
    fromClickhouseRow,
} from "@/core/clickhouse/from-event-row";
import type { ClickhouseEventReadRow } from "@/core/clickhouse/event-row.types";
import {
    pickDominantLevel,
    levelCounts,
    type EventLevel,
    type RollupLevelRow,
} from "@/shared/utils/dominant-level";
import {
    hasEnvFilter,
    type EventBucket,
    type LevelledBucket,
} from "@/shared/utils/event-buckets";
import type { Event } from "@/shared/types/event.types";

/**
 * The aggregations behind both dashboards.
 *
 * **Why one module (2026-08-25).** The organization overview and the project
 * dashboard asked the same questions of the same tables through two services —
 * `overview.service.ts` at 699 lines and `aggregations.service.ts` at 600 —
 * whose queries differed mainly in whether the scope was one `project_id` or a
 * list of them. Two copies of one query is two places for the next `ORDER BY`
 * defect to hide, and this codebase has already paid that bill three times.
 *
 * **The organization page is the project page over several projects.** Every
 * query here takes `projectIds: string[]`; the project route passes `[id]` and
 * the org route passes all of them. Nothing else about them differs.
 *
 * Lives in `shared/` because `PROJECT.md` §2.1 forbids one feature importing
 * another and both features need this.
 *
 * ## On ClickHouse since Phase 4 — what stopped existing
 *
 * This file was 1,449 lines, and roughly half of them were **not about the
 * questions**. They were about a Postgres rollup being a *different table* from
 * `events`: a watermark, a coverage interval, a raw tail unioned above it, four
 * floor checks answering "can this summary be trusted for this question", and
 * two implementations each of `topMessages` and `topSources` chosen between at
 * runtime. Nearly every one of those produced a silently wrong answer at least
 * once (`09-clickhouse.md` §1.2).
 *
 * None of it survives, and none of it was replaced. Each read here is **one
 * query over the raw table** — tier 2 in §6.2's language, where falling back to
 * a scan is normal rather than exceptional. Phase 5 adds the `p_minute`
 * projection, and the point of a projection is that it lives *inside* the
 * table: the optimizer picks it, the application does not, so nothing here has
 * to learn about it. That property is why §1.2 counts the machinery as the cost
 * of the old design rather than as work.
 *
 * **What did not change is the shape.** Every export keeps its signature and
 * its return type, so no caller and no component was touched — the same
 * property that kept Phase 3 to the read path. One *answer* did change on
 * purpose, and it is called out on `topMessages`.
 *
 * The **pure** half lives in `shared/utils/event-buckets.ts`, not here. This
 * module imports a database client, so a `"use client"` component importing a
 * value from it drags the driver into the browser bundle and fails the build.
 */

export type DateRange = { from: Date; to: Date };

// Re-exported so a server caller needs one import. A client component must
// import from `@/shared/utils/event-buckets` directly instead; see above.
export {
    emptyBucket,
    emptyLevelledBucket,
    errorsIn,
    fillBuckets,
    hasEnvFilter,
    type EventBucket,
    type LevelledBucket,
} from "@/shared/utils/event-buckets";

/**
 * What an event with no environment is called on screen.
 *
 * A pill, not a hole: an event that never named an environment is one of the
 * things a person wants to look at. Postgres held `NULL` and every read
 * `COALESCE`d it; the ClickHouse schema has no `Nullable` anywhere (§4.1), so
 * blank is the stored form and this is still the label.
 */
const UNSET_ENVIRONMENT = "(unset)";

/** The same, for a source. Different word, same reason. */
const UNKNOWN_SOURCE = "(unknown)";

/** `error` and `fatal` — what both dashboards mean by "errors". */
const ERROR_LEVELS = ["error", "fatal"] as const;

/**
 * A list of level names as SQL literals.
 *
 * The only place in this module that puts text into a query without binding it,
 * and every value it is given is a `const` declared in this file or in
 * `EVENT_LEVELS` — never a request. Binding would work
 * (`level IN {p:Array(String)}`) and is not used for one reason: `level` is an
 * `Enum8`, and comparing it against literals lets ClickHouse resolve the names
 * to their byte values when it parses the query.
 */
function quoted(levels: readonly string[]): string {
    return levels.map((level) => `'${level}'`).join(", ");
}

/**
 * Run one aggregate query.
 *
 * `clickhouse_settings` is left at its default on purpose: a `UInt64` count
 * comes back **quoted**, and every count here is read through `Number`. The one
 * read that must turn that off is `recentErrors`, which returns whole events —
 * and turning it off globally would round a `UInt64` fingerprint. See
 * `EVENT_READ_SETTINGS`.
 *
 * ## Never alias a converted column back to its own name
 *
 * ClickHouse resolves a select-list alias inside `WHERE`, so
 * `SELECT toString(project_id) AS project_id … WHERE project_id IN
 * {p:Array(UUID)}` compares a `String` against an array of `UUID` — and
 * returns **no rows, without raising**. Every bucket and every per-project
 * count in this module was empty for exactly that reason on 2026-08-26; the
 * integration suite caught it and nothing else could have, because the SQL
 * is valid and the answer is merely wrong.
 *
 * The conversions were not needed in the first place: `JSONEachRow` renders
 * a `UUID`, an `Enum8` and an `IPv6` as strings already. The only column on
 * the read path that genuinely needs converting is `template_hash`
 * (`from-event-row.ts`), and nothing filters on it.
 */
async function selectRows<T>(query: string, bag: ParamBag): Promise<T[]> {
    const result = await clickhouse.query({
        query,
        query_params: bag.params,
        format: "JSONEachRow",
    });
    return result.json<T>();
}

/**
 * The `WHERE` every query here starts from: a project set, a half-open time
 * window, and optionally an environment filter.
 *
 * Half-open (`>= from`, `< to`) because that is what every Postgres query here
 * used, and a bucket boundary belongs to exactly one bucket.
 *
 * Every value goes through the bag. There is no Drizzle dialect for ClickHouse,
 * so nothing else stands between a string out of a URL and the SQL text — see
 * `core/clickhouse/params.ts`.
 */
function scopeWhere(
    bag: ParamBag,
    projectIds: string[],
    range: DateRange,
    environments?: string[],
): string {
    const clauses = [
        `project_id IN ${bag.add(projectIds, "Array(UUID)")}`,
        `timestamp >= ${bag.add(range.from, "DateTime64(3, 'UTC')")}`,
        `timestamp <  ${bag.add(range.to, "DateTime64(3, 'UTC')")}`,
    ];

    if (hasEnvFilter(environments)) {
        clauses.push(`${environmentLabel(bag)} IN ${bag.add(environments, "Array(String)")}`);
    }

    return clauses.join(" AND ");
}

/**
 * `environment`, with blank shown as `(unset)`.
 *
 * The label is on **both** sides of the filter, and that is load-bearing: it
 * was missing on the filter side under Postgres, where `environment = ANY(...)`
 * never matches `NULL`, so selecting the `(unset)` pill narrowed every widget
 * to nothing and looked like a quiet period.
 */
function environmentLabel(bag: ParamBag): string {
    return `if(environment = '', ${bag.add(UNSET_ENVIRONMENT, "String")}, environment)`;
}

/**
 * Epoch-floor bucketing, straight to milliseconds.
 *
 * `toStartOfInterval` is the obvious function and is **not** used: it returns
 * `DateTime`, not `DateTime64`, so `toUnixTimestamp64Milli` rejects its result
 * outright (measured — `lab/clickhouse/probe-aggregate-shapes.mjs`). The
 * arithmetic below is what Postgres did, agrees with `toStartOfInterval` on
 * every width the UI asks for, and yields the epoch milliseconds every other
 * read here returns.
 *
 * Every width in `BUCKET_SECONDS` is a whole number of minutes (asserted in
 * `dashboard-filters.test.ts`), so truncating to seconds loses nothing.
 */
function bucketMillis(bag: ParamBag, bucketSecs: number): string {
    const secs = bag.add(bucketSecs, "UInt32");
    return `intDiv(toUnixTimestamp(timestamp), ${secs}) * ${secs} * 1000`;
}

/** The five per-level counters, as one `SELECT` fragment. */
const LEVEL_COUNTERS = `
    countIf(level = 'debug') AS n_debug,
    countIf(level = 'info')  AS n_info,
    countIf(level = 'warn')  AS n_warn,
    countIf(level = 'error') AS n_error,
    countIf(level = 'fatal') AS n_fatal
`;

/**
 * The template text to show for a group.
 *
 * `message_template` is written by ingest and is what the group is *called*.
 * The fallback covers rows stored before that column existed: their
 * `template_hash` is still right, so they group correctly and only the label is
 * missing. Showing the raw message beats showing nothing.
 */
const TEMPLATE_LABEL = "if(message_template = '', message, message_template)";

/**
 * Which project owns a template that several of them logged.
 *
 * The one contributing the most events, ties broken toward the smaller id.
 * Replaces `ROW_NUMBER() OVER (PARTITION BY … ORDER BY total DESC, project_id)`
 * joined back to itself: `argMin` over the tuple expresses the same rule in one
 * pass, and negating the count is what turns "largest" into the "smallest" the
 * function looks for. Verified against the server, tie included —
 * `lab/clickhouse/probe-aggregate-shapes.mjs`.
 */
const OWNING_PROJECT = "argMin(project_id, (-toInt64(per_project), project_id))";

/**
 * Event counts and error counts per project per time bucket.
 *
 * One query. Under Postgres this was two — a summary table below a completeness
 * watermark and raw events above it — because the rollup held only *closed*
 * minutes and the minute someone is watching is the newest one. There is no
 * watermark to be above.
 *
 * {@link eventBucketsByLevel} is the same query with per-level detail. They
 * stayed two functions after the move: the reason was never the storage but the
 * question, and the organization chart plots a ratio while the project
 * dashboard plots a stacked area. See `LevelledBucket`.
 */
export async function eventBuckets(
    projectIds: string[],
    range: DateRange,
    bucketSecs: number,
    environments?: string[],
): Promise<EventBucket[]> {
    if (projectIds.length === 0) return [];

    const bag = new ParamBag();
    const where = scopeWhere(bag, projectIds, range, environments);
    const ts = bucketMillis(bag, bucketSecs);

    const rows = await selectRows<PlainBucketRow>(
        `SELECT project_id,
                ${ts} AS ts_ms,
                count() AS total,
                countIf(level IN (${quoted(ERROR_LEVELS)})) AS errors
         FROM ${EVENTS_TABLE}
         WHERE ${where}
         GROUP BY project_id, ts_ms
         ORDER BY ts_ms`,
        bag,
    );

    return rows.map((row) => ({
        projectId: row.project_id,
        ts: new Date(Number(row.ts_ms)),
        total: Number(row.total),
        errors: Number(row.errors),
    }));
}

type PlainBucketRow = { project_id: string; ts_ms: string; total: string; errors: string };

/**
 * The same buckets, with counts per level.
 *
 * Only the project dashboard's stacked-area chart needs this. Under Postgres it
 * cost ~8× a plain bucket read, because the per-level counts lived in a `jsonb`
 * marginal and getting them meant a JSON parse per row. Here it is four more
 * `countIf`s over a column already being read.
 */
export async function eventBucketsByLevel(
    projectIds: string[],
    range: DateRange,
    bucketSecs: number,
    environments?: string[],
): Promise<LevelledBucket[]> {
    if (projectIds.length === 0) return [];

    const bag = new ParamBag();
    const where = scopeWhere(bag, projectIds, range, environments);
    const ts = bucketMillis(bag, bucketSecs);

    const rows = await selectRows<LevelBucketRow>(
        `SELECT project_id,
                ${ts} AS ts_ms,
                level,
                count() AS cnt
         FROM ${EVENTS_TABLE}
         WHERE ${where}
         GROUP BY project_id, ts_ms, level
         ORDER BY ts_ms`,
        bag,
    );

    return collapseLevelled(rows);
}

type LevelBucketRow = { project_id: string; ts_ms: string; level: string; cnt: string };

/** Flat `(project, ts, level, count)` rows into one entry per project per bucket. */
function collapseLevelled(rows: LevelBucketRow[]): LevelledBucket[] {
    const byKey = new Map<string, LevelledBucket>();

    for (const row of rows) {
        const ts = new Date(Number(row.ts_ms));
        const key = `${row.project_id}@${ts.getTime()}`;
        let bucket = byKey.get(key);
        if (!bucket) {
            bucket = { projectId: row.project_id, ts, total: 0, errors: 0, byLevel: {} };
            byKey.set(key, bucket);
        }
        const n = Number(row.cnt);
        bucket.total += n;
        if (row.level === "error" || row.level === "fatal") bucket.errors += n;
        bucket.byLevel[row.level] = (bucket.byLevel[row.level] ?? 0) + n;
    }

    return [...byKey.values()];
}

/**
 * Events in the trailing sixty seconds, per project.
 *
 * Its own tiny query, and that is the point. The rate used to be an average
 * over the page's range, derived from the bucket series — so at 30 days it
 * divided a month's total by 43,200 and called the answer "events / min". Asked
 * for the *current* rate instead, the buckets cannot supply it at all: at a
 * 30-day range `bucketSecs` is 86,400 and the minute is not in them.
 *
 * The window boundary is computed **here** rather than as `now()` in SQL. Both
 * clocks are arbitrary — an event's timestamp can come from the client — and
 * one of them can be frozen by a test.
 *
 * `environments` is supported and no longer passed by anything: its one caller
 * is the project layout, which renders `ProjectPulse` in the top bar and cannot
 * read `searchParams`. Kept because the parameter costs nothing.
 */
export async function eventsInLastMinute(
    projectIds: string[],
    environments?: string[],
): Promise<number> {
    if (projectIds.length === 0) return 0;

    const now = new Date();
    const range = { from: new Date(now.getTime() - 60_000), to: now };

    const bag = new ParamBag();
    const where = scopeWhere(bag, projectIds, range, environments);

    const [row] = await selectRows<{ n: string }>(
        `SELECT count() AS n FROM ${EVENTS_TABLE} WHERE ${where}`,
        bag,
    );
    return Number(row?.n ?? 0);
}

/** One level and how many events carried it. */
export type LevelCount = {
    level: string;
    count: number;
};

/**
 * Event counts per level, across the whole scope.
 *
 * Under Postgres an environment filter forced this onto raw `events`, because
 * the rollup stored level and environment as separate *marginals* and "how many
 * errors in production" needs their joint distribution — a question those
 * marginals cannot answer at any grain. Here both are columns of the same row
 * and the filtered question is the unfiltered one with a clause on it.
 */
export async function levelBreakdown(
    projectIds: string[],
    range: DateRange,
    environments?: string[],
): Promise<LevelCount[]> {
    if (projectIds.length === 0) return [];

    const bag = new ParamBag();
    const where = scopeWhere(bag, projectIds, range, environments);

    const rows = await selectRows<{ level: string; count: string }>(
        `SELECT level, count() AS count
         FROM ${EVENTS_TABLE}
         WHERE ${where}
         GROUP BY level
         -- The alias is a UInt64 here, not text. Postgres resolved an ORDER BY
         -- name against the select list first, so ordering by a ::text count
         -- ranked 9 above 10 -- a defect that shipped three times in this
         -- codebase and stayed invisible because the widget re-sorted on the
         -- client. ClickHouse has real types and no such trap; the tiebreak
         -- below is what makes the order deterministic rather than correct.
         ORDER BY count DESC, level ASC`,
        bag,
    );

    return rows.map((row) => ({ level: row.level, count: Number(row.count) }));
}

/**
 * One frequent message, and which project it belongs to.
 *
 * `message` is the **template** — `User u_487 signed in` and `User u_912 signed
 * in` are one entry — not any single event's text. See {@link topMessages}.
 */
export type TopMessage = {
    message: string;
    count: number;
    projectId: string;
    latestAt: Date;
    dominantLevel: EventLevel;
};

export type TopMessagesOptions = {
    /**
     * Rank and count only these levels. Omitted means every level.
     *
     * **Not caller-supplied in the sense of coming from a request.** Until
     * 2026-08-20 the overview's level filter could widen its own "top errors"
     * widget to any levels at all, so a widget labelled *errors* would happily
     * return debug lines. The filter is gone; this parameter exists so the two
     * dashboards' two questions are one function, and each caller passes a
     * constant.
     */
    levels?: readonly EventLevel[];
    environments?: string[];
    limit?: number;
};

/**
 * The most frequent message templates in scope.
 *
 * ## It groups by template, always — and that is a fix, not a port
 *
 * Postgres had **two** implementations chosen by a coverage check: one grouped
 * by a `bigint` fingerprint over `event_template_rollup`, the other by
 * `SUBSTRING(message, 1, 200)` over raw `events`. Those are not the same
 * question. The first says `User *** signed in` happened 4,000 times; the
 * second says four thousand different things each happened once. Which answer
 * the widget showed depended on whether a rollup covered the range and on
 * whether an environment filter was active — a difference no caller could see
 * and no test asserted.
 *
 * Grouping is by `template_hash` and the label is `message_template`, both
 * written on the row at ingest. The template text is stored per row rather than
 * joined from a registry table because the normaliser is TypeScript and has no
 * SQL equivalent — see `core/clickhouse/schema.sql` and §12.4.
 *
 * ## Cost
 *
 * A `UInt64` group key rather than 200 characters of text, over one scan. The
 * measurement that drove the Postgres design — 17 s over 1.13M text groups on
 * staging — was about hashing strings, and there are no strings to hash.
 */
export async function topMessages(
    projectIds: string[],
    range: DateRange,
    options: TopMessagesOptions = {},
): Promise<TopMessage[]> {
    if (projectIds.length === 0) return [];
    const { levels, environments, limit = 10 } = options;

    const bag = new ParamBag();
    const clauses = [scopeWhere(bag, projectIds, range, environments)];
    // Restricting the levels restricts the counters too, which is what a widget
    // titled "top errors" means by "how often" -- and it drops a template that
    // never occurred at one of them, rather than ranking a thousand info lines
    // above two errors.
    if (levels) clauses.push(`level IN (${quoted(levels)})`);

    const rows = await selectRows<TopMessageRow>(
        `WITH per_project AS (
             SELECT template_hash,
                    project_id,
                    count() AS per_project,
                    max(timestamp) AS latest,
                    any(${TEMPLATE_LABEL}) AS template,
                    ${LEVEL_COUNTERS}
             FROM ${EVENTS_TABLE}
             WHERE ${clauses.join(" AND ")}
             GROUP BY template_hash, project_id
         )
         SELECT any(template) AS message,
                sum(per_project) AS total,
                toUnixTimestamp64Milli(max(latest)) AS latest_ms,
                ${OWNING_PROJECT} AS project_id,
                sum(n_debug) AS n_debug, sum(n_info) AS n_info, sum(n_warn) AS n_warn,
                sum(n_error) AS n_error, sum(n_fatal) AS n_fatal
         FROM per_project
         GROUP BY template_hash
         ORDER BY total DESC, message ASC
         LIMIT ${bag.add(limit, "UInt32")}`,
        bag,
    );

    return rows.map((row) => toTopMessage(row, levels));
}

type TopMessageRow = RollupLevelRow & {
    message: string;
    total: string;
    latest_ms: string;
    project_id: string;
};

/**
 * Shape a query row into a {@link TopMessage}.
 *
 * When `levels` restricts the question, counters outside it are zeroed before
 * picking a dominant level. Without that, a template with a thousand `info`
 * lines and two `error`s would be badged `info` in a widget titled *top
 * errors* — the badge would describe the template, while the ranking beside it
 * described the errors.
 */
function toTopMessage(row: TopMessageRow, levels: readonly EventLevel[] | undefined): TopMessage {
    const counts = levelCounts(row);
    const restricted = levels
        ? Object.fromEntries(levels.map((level) => [level, counts[level] ?? 0]))
        : counts;

    return {
        message: row.message,
        count: Number(row.total),
        projectId: row.project_id,
        latestAt: new Date(Number(row.latest_ms)),
        dominantLevel: pickDominantLevel(restricted),
    };
}

/** One event source and how many events came from it. */
export type SourceCount = {
    source: string;
    count: number;
};

/**
 * Top N event sources by event count.
 *
 * Postgres had two implementations here too, and two *floors* deciding between
 * them: one about whether a rollup row carried a `by_source` map at all, the
 * other about whether it could be attributed to a single environment. Both are
 * questions about a summary table. There is no summary table.
 */
export async function topSources(
    projectIds: string[],
    range: DateRange,
    options: { environments?: string[]; limit?: number } = {},
): Promise<SourceCount[]> {
    if (projectIds.length === 0) return [];
    const { environments, limit = 10 } = options;

    const bag = new ParamBag();
    const where = scopeWhere(bag, projectIds, range, environments);
    const source = `if(source = '', ${bag.add(UNKNOWN_SOURCE, "String")}, source)`;

    const rows = await selectRows<{ source: string; count: string }>(
        `SELECT ${source} AS source, count() AS count
         FROM ${EVENTS_TABLE}
         WHERE ${where}
         GROUP BY source
         -- With a LIMIT an unstable order does not merely reorder the list, it
         -- returns different ROWS. Under Postgres a lexicographic sort on a
         -- text count put a source with 10 events below every source with 2
         -- through 9 and dropped it off the end of the widget.
         ORDER BY count DESC, source ASC
         LIMIT ${bag.add(limit, "UInt32")}`,
        bag,
    );

    return rows.map((row) => ({ source: row.source, count: Number(row.count) }));
}

/**
 * The most recent error and fatal events in scope.
 *
 * The one read here that returns **events rather than an aggregate**, so it is
 * the one that needs the full column list and the reverse mapper — which is why
 * both live in `core/clickhouse/from-event-row.ts` rather than in
 * `features/events`, where `shared/` could not reach them.
 *
 * Cheap by construction: the sort key leads on `(project_id, timestamp)` and
 * there is a `LIMIT`, so a descending scan stops after ten rows.
 */
export async function recentErrors(
    projectIds: string[],
    range: DateRange,
    options: { environments?: string[]; limit?: number } = {},
): Promise<Event[]> {
    if (projectIds.length === 0) return [];
    const { environments, limit = 10 } = options;

    const bag = new ParamBag();
    const where = scopeWhere(bag, projectIds, range, environments);

    const result = await clickhouse.query({
        query: `SELECT ${EVENT_READ_COLUMNS}
                FROM ${EVENTS_TABLE}
                WHERE ${where} AND level IN (${quoted(ERROR_LEVELS)})
                ORDER BY timestamp DESC, id DESC
                LIMIT ${bag.add(limit, "UInt32")}`,
        query_params: bag.params,
        format: "JSONEachRow",
        clickhouse_settings: EVENT_READ_SETTINGS,
    });

    return (await result.json<ClickhouseEventReadRow>()).map(fromClickhouseRow);
}

/**
 * True if any project in scope has ever received an event.
 *
 * Gates the onboarding screen. Unbounded in time on purpose — "has this project
 * ever" — and cheap anyway: `project_id` leads the sort key, so this reads one
 * granule and stops.
 *
 * Under Postgres it asked two tables, because a project whose first event
 * arrived in the last minute had no rollup row yet and is emphatically not
 * empty; showing it the onboarding screen would be the worst possible moment to
 * do so. One table, one question now.
 *
 * The one read the caches skip, and for the same reason: the single moment its
 * answer changes is the single moment a stale "no events yet" would be worst.
 */
export async function hasAnyEvents(projectIds: string[]): Promise<boolean> {
    if (projectIds.length === 0) return false;

    const bag = new ParamBag();
    const rows = await selectRows<{ one: number }>(
        `SELECT 1 AS one
         FROM ${EVENTS_TABLE}
         WHERE project_id IN ${bag.add(projectIds, "Array(UUID)")}
         LIMIT 1`,
        bag,
    );
    return rows.length > 0;
}

/**
 * Everything about a project the KPI row displays: counts and the environments
 * it used.
 *
 * Split from the top message on 2026-08-20. They used to be one type returned
 * by one function, which meant one promise, which meant the KPI row waited
 * ~954 ms for a message aggregation it does not display. See
 * {@link topMessagePerProject} for the other half.
 */
export type ProjectStats = {
    projectId: string;
    totalEvents: number;
    errorCount: number;
    environments: string[];
};

/** The most frequent error message for one project, and its dominant level. */
export type ProjectTopMessage = {
    message: string;
    level: string;
};

/**
 * Counts and environments per project.
 *
 * Two queries in one round trip, not one query: the counts are filtered and the
 * environment pills are not. The pills describe **the project**, not the current
 * view — narrowing them to the active filter would make the option you just
 * selected the only one left.
 *
 * A project with no events in the range gets no `GROUP BY` row and so is simply
 * absent from the map, which is what the Postgres version spelled out as
 * `HAVING SUM(total) > 0`.
 */
export async function projectStats(
    projectIds: string[],
    range: DateRange,
    environments?: string[],
): Promise<Map<string, ProjectStats>> {
    if (projectIds.length === 0) return new Map();

    const [statsRows, envRows] = await Promise.all([
        selectProjectCounts(projectIds, range, environments),
        selectProjectEnvironments(projectIds, range),
    ]);

    const envMap = new Map(envRows.map((row) => [row.project_id, row.envs]));

    return new Map(
        statsRows.map((row) => [
            row.project_id,
            {
                projectId: row.project_id,
                totalEvents: Number(row.total),
                errorCount: Number(row.error_count),
                environments: [...(envMap.get(row.project_id) ?? [])].sort(),
            },
        ]),
    );
}

function selectProjectCounts(
    projectIds: string[],
    range: DateRange,
    environments?: string[],
): Promise<Array<{ project_id: string; total: string; error_count: string }>> {
    const bag = new ParamBag();
    const where = scopeWhere(bag, projectIds, range, environments);

    return selectRows(
        `SELECT project_id,
                count() AS total,
                countIf(level IN (${quoted(ERROR_LEVELS)})) AS error_count
         FROM ${EVENTS_TABLE}
         WHERE ${where}
         GROUP BY project_id`,
        bag,
    );
}

/**
 * The environments each project used in this range.
 *
 * Returns a real array rather than a delimited string. An earlier Postgres
 * version joined with `STRING_AGG(…, ',')` and split on "," in TypeScript,
 * which turned an environment named `eu,prod` into two — reachable through the
 * public ingest API, since `environment` is validated only as a string.
 *
 * An event with no environment contributes no pill, which is why blank is
 * excluded here rather than labelled. The two reserved labels this used to
 * exclude alongside it — `(all)` and `(other)` — described rows in a summary
 * table that no longer exists.
 */
function selectProjectEnvironments(
    projectIds: string[],
    range: DateRange,
): Promise<Array<{ project_id: string; envs: string[] }>> {
    const bag = new ParamBag();
    const where = scopeWhere(bag, projectIds, range);

    return selectRows(
        `SELECT project_id, groupUniqArray(environment) AS envs
         FROM ${EVENTS_TABLE}
         WHERE ${where} AND environment != ''
         GROUP BY project_id`,
        bag,
    );
}

/**
 * The most frequent error message per project.
 *
 * **This was the overview's most expensive query** — 4,931 ms on staging, more
 * than the rest of the page put together, which is why it sits behind its own
 * `Suspense` boundary and why a second rollup table existed to serve it. It
 * groups by `template_hash` now, like {@link topMessages}, and the two agree
 * about what a message *is* for the first time.
 *
 * `LIMIT 1 BY` is ClickHouse's own idiom for "the top row per group" and
 * replaces `ROW_NUMBER() … WHERE rn = 1`. The `ORDER BY` has to name the
 * partition column first for it to work.
 */
export async function topMessagePerProject(
    projectIds: string[],
    range: DateRange,
    environments?: string[],
): Promise<Map<string, ProjectTopMessage>> {
    if (projectIds.length === 0) return new Map();

    const bag = new ParamBag();
    const where = scopeWhere(bag, projectIds, range, environments);

    const rows = await selectRows<ProjectTopMessageRow>(
        `SELECT project_id,
                any(${TEMPLATE_LABEL}) AS message,
                count() AS total,
                ${LEVEL_COUNTERS}
         FROM ${EVENTS_TABLE}
         WHERE ${where} AND level IN (${quoted(ERROR_LEVELS)})
         GROUP BY project_id, template_hash
         -- template_hash last, so two templates tied on count resolve the same
         -- way on every load rather than however the parts happened to merge.
         ORDER BY project_id, total DESC, template_hash
         LIMIT 1 BY project_id`,
        bag,
    );

    return new Map(
        rows.map((row) => [
            row.project_id,
            // Only error and fatal are counted -- this widget answers "worst
            // error", not "most frequent message" -- so the other three
            // counters are zero and pickDominantLevel chooses between two.
            { message: row.message, level: pickDominantLevel(levelCounts(row)) },
        ]),
    );
}

type ProjectTopMessageRow = RollupLevelRow & {
    project_id: string;
    message: string;
    total: string;
};

/**
 * How far back {@link environmentsInUse} looks. Thirty days, as the
 * `project_environments` registry's `last_seen_at` window was.
 */
const ENVIRONMENT_LOOKBACK_DAYS = 30;

/**
 * The environments offered by a filter bar.
 *
 * **This was a registry table** (`project_environments`), maintained at ingest,
 * because the implementation *it* replaced scanned 30 days of events on every
 * page load and `pg_stat_statements` put that at 13.4% of the page's total
 * database time. Phase 4 goes back to the scan, deliberately: `environment` is
 * `LowCardinality`, so this reads one dictionary-encoded column and nothing
 * else, and Phase 5's `p_minute` projection carries `environment` in its key —
 * at which point the optimizer answers this from the aggregate without the
 * application knowing. Keeping a Postgres table maintained by ingest to avoid a
 * ClickHouse `GROUP BY` is exactly the machinery §1.2 counts as the cost.
 *
 * Deliberately unchanged: this ignores the range selected in the filter bar,
 * exactly as both implementations before it did. The list is "what this
 * organization uses", not "what appeared in the last hour" — narrowing it to
 * the range would make an option vanish the moment you selected a window in
 * which it had no events.
 *
 * Ordering is byte-wise, which is what the previous version wanted and had to
 * work around: it sorted in TypeScript because a database collation orders
 * punctuation differently and `(unset)` would move.
 */
export async function environmentsInUse(projectIds: string[]): Promise<string[]> {
    if (projectIds.length === 0) return [];

    const to = new Date();
    const from = new Date(to.getTime() - ENVIRONMENT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

    const bag = new ParamBag();
    const where = scopeWhere(bag, projectIds, { from, to });
    const label = environmentLabel(bag);

    const rows = await selectRows<{ environment: string }>(
        `SELECT DISTINCT ${label} AS environment
         FROM ${EVENTS_TABLE}
         WHERE ${where}
         ORDER BY environment`,
        bag,
    );

    return rows.map((row) => row.environment);
}
