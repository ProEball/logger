import { sql } from "drizzle-orm";
import { db } from "@/core/db/client";
import { rollupBoundary, templateCoverageForProjects } from "@/shared/services/rollup-boundary.service";
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
import type { Event } from "@/core/db/schema";

/**
 * The aggregations behind both dashboards.
 *
 * **Why one module (2026-08-25).** The organization overview and the project
 * dashboard asked the same questions of the same tables through two services —
 * `overview.service.ts` at 699 lines and `aggregations.service.ts` at 600 —
 * whose queries differed mainly in whether the scope was one `project_id` or a
 * list of them. Two copies of a union-over-rollup query is two places for the
 * next `ORDER BY` defect to hide, and this codebase has already paid that bill:
 * three text-alias ordering bugs, found one page at a time.
 *
 * **The organization page is the project page over several projects.** Every
 * query here takes `projectIds: string[]`; the project route passes `[id]` and
 * the org route passes all of them. Nothing else about them differs.
 *
 * Lives in `shared/` because `PROJECT.md` §2.1 forbids one feature importing
 * another and both features need this — the same reasoning that moved
 * `rollup-boundary.service.ts` and `read-cache-settings.ts` here before it.
 *
 * The **pure** half lives in `shared/utils/event-buckets.ts`, not here. This
 * module imports `@/core/db/client`, so a `"use client"` component importing a
 * value from it drags `postgres` — and therefore `fs` — into the browser bundle
 * and fails the production build.
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
 * `db.execute()` passes values raw to postgres.js, which cannot serialize `Date`
 * for a parameterized query. ISO string plus an explicit cast makes the driver
 * send text and lets PostgreSQL do the conversion.
 */
function toTs(d: Date) {
    return sql`${d.toISOString()}::timestamptz`;
}

function uuidArray(ids: string[]) {
    return sql.join(
        ids.map((id) => sql`${id}::uuid`),
        sql`, `,
    );
}

/**
 * Narrows raw `events` to the selected environments. Empty when unfiltered, so
 * the same query text serves both paths.
 *
 * **`COALESCE` is load-bearing, added 2026-08-25.** `environmentsInUse` offers
 * `(unset)` as a pill, because an event without an environment is one of the
 * things a person wants to look at. This clause was a bare
 * `environment = ANY(...)`, and SQL equality never matches NULL — so selecting
 * that pill narrowed every widget to nothing and looked like a quiet period.
 * The label already existed on the read side; only the filter side was missing
 * it.
 */
function envCond(environments?: string[]) {
    if (!hasEnvFilter(environments)) return sql``;
    return sql` AND COALESCE(environment, '(unset)') = ANY(ARRAY[${sql.join(
        environments!.map((e) => sql`${e}`),
        sql`, `,
    )}])`;
}

/**
 * The same narrowing against the rollup, where `environment` is a key column and
 * `(unset)` is already stored as that literal — so no `COALESCE` is needed and
 * the predicate can use the primary key.
 */
function rollupEnvCond(environments?: string[]) {
    if (!hasEnvFilter(environments)) return sql``;
    return sql` AND environment = ANY(ARRAY[${sql.join(
        environments!.map((e) => sql`${e}`),
        sql`, `,
    )}])`;
}

/**
 * Epoch-floor bucketing, as a SQL fragment.
 *
 * `date_trunc` only takes unit names — 'minute', 'hour' — so it cannot express a
 * 6-hour or 5-minute width. Floor arithmetic works for any width in seconds, and
 * every width the UI asks for is a whole number of minutes (asserted in
 * `dashboard-filters.test.ts`), so a bucket never splits a stored rollup row.
 *
 * `secs` is inlined with `sql.raw` rather than parameterised because it comes
 * from `BUCKET_SECONDS`, a controlled constant table — never from a request.
 */
function bucketed(column: ReturnType<typeof sql>, secs: number) {
    const s = sql.raw(String(secs));
    return sql`to_timestamp(floor(extract(epoch from ${column}) / ${s}) * ${s})`;
}

/**
 * Whether the rollup can answer an **environment-filtered** question for this
 * scope and range, and `null` when it can.
 *
 * Two things disqualify it, both detected as rows rather than assumed:
 *
 * - An **`(all)`** row: written by migration 0014 onto minutes that predate the
 *   `environment` key and therefore mix every environment together. Summing
 *   across one is exact, filtering on one is not.
 * - An **`(other)`** row: a minute where more environments were active than
 *   `ENVIRONMENT_KEY_CAP` allows, so the tail was folded. That minute's
 *   per-environment counts are incomplete by construction.
 *
 * Returns the **newest disqualifying minute**, so a caller can ask "does my
 * range reach back into it". `MAX` is the right aggregate for `(all)`, which
 * forms a contiguous band ending at the migration and is refilled oldest-first —
 * exactly the shape `sourceRollupFloor` handles. It is *conservative* for
 * `(other)`, which can appear at any minute: one busy minute last Tuesday sends
 * every filtered read older than it to raw `events`.
 *
 * That conservatism is deliberate. The alternative is a per-minute check inside
 * the read, which means the query cannot decide its own plan up front, and the
 * failure mode it protects against — an environment folded into `(other)`
 * reported as though it had no events — is silent on screen. A slow correct
 * answer is recoverable; a fast wrong one is not.
 */
async function envRollupFloor(projectIds: string[]): Promise<Date | null> {
    const [row] = await db.execute<{ newest: Date | null }>(sql`
        SELECT MAX(minute) AS newest
        FROM event_rollup_minutes
        WHERE project_id = ANY(ARRAY[${uuidArray(projectIds)}])
          AND environment IN ('(all)', '(other)')
    `);
    return row?.newest == null ? null : new Date(row.newest);
}

/**
 * Can a filtered read of `[from, …]` use the rollup?
 *
 * True when nothing disqualifying sits at or after `from`. Unfiltered reads
 * never ask: they sum across every environment row, `(all)` and `(other)`
 * included, and are exact regardless.
 */
async function envRollupUsable(projectIds: string[], from: Date): Promise<boolean> {
    const floor = await envRollupFloor(projectIds);
    return floor === null || from > floor;
}


/**
 * Event counts and error counts per project per time bucket.
 *
 * Reads `total` and the generated `errors` column — plain integers, no jsonb
 * expansion. {@link eventBucketsByLevel} is the same query with per-level
 * detail and costs roughly **eight times** as much; `LevelledBucket` carries the
 * measurement and the reason the two are not one function.
 *
 * ## Two paths, and why
 *
 * Unfiltered, this reads `event_rollup_minutes` below the completeness boundary
 * and raw `events` above it. The tail is not an optimisation detail — the rollup
 * only ever holds *closed* minutes, so without the union the chart would always
 * be missing the newest minute, which on a logging tool is the minute someone is
 * watching.
 *
 * Filtered, it reads the rollup too: `environment` has been a key column since
 * 2026-08-25, so "errors in production per minute" is one `WHERE` clause rather
 * than a question the old marginals could not answer at all. It falls back to
 * raw `events` only where the rollup cannot be trusted for a filtered read — a
 * minute that folded environments into `(other)`, or one written before the key
 * existed. See `envRollupFloor`.
 */
export async function eventBuckets(
    projectIds: string[],
    range: DateRange,
    bucketSecs: number,
    environments?: string[],
): Promise<EventBucket[]> {
    if (projectIds.length === 0) return [];
    const { from, to } = range;
    const ids = uuidArray(projectIds);

    const useRollup =
        !hasEnvFilter(environments) || (await envRollupUsable(projectIds, from));

    if (!useRollup) {
        return collapsePlain(
            await db.execute<PlainBucketRow>(sql`
                SELECT
                    project_id::text,
                    ${bucketed(sql`timestamp`, bucketSecs)}                   AS ts,
                    COUNT(*)::text                                            AS total,
                    COUNT(*) FILTER (WHERE level IN ('error', 'fatal'))::text AS errors
                FROM events
                WHERE project_id = ANY(ARRAY[${ids}])
                  AND timestamp >= ${toTs(from)}
                  AND timestamp <  ${toTs(to)}
                  ${envCond(environments)}
                GROUP BY 1, 2
                ORDER BY 2
            `),
        );
    }

    const boundary = (await rollupBoundary(projectIds)) ?? from;

    return collapsePlain(
        await db.execute<PlainBucketRow>(sql`
            WITH rolled AS (
                SELECT project_id,
                       ${bucketed(sql`minute`, bucketSecs)} AS ts,
                       total, errors
                FROM event_rollup_minutes
                WHERE project_id = ANY(ARRAY[${ids}])
                  AND minute >= ${toTs(from)}
                  AND minute <  LEAST(${toTs(to)}, ${toTs(boundary)})
                  ${rollupEnvCond(environments)}
            ),
            fresh AS (
                SELECT project_id,
                       ${bucketed(sql`timestamp`, bucketSecs)}                   AS ts,
                       COUNT(*)::int                                             AS total,
                       COUNT(*) FILTER (WHERE level IN ('error', 'fatal'))::int  AS errors
                FROM events
                WHERE project_id = ANY(ARRAY[${ids}])
                  AND timestamp >= GREATEST(${toTs(from)}, ${toTs(boundary)})
                  AND timestamp <  ${toTs(to)}
                  ${envCond(environments)}
                GROUP BY 1, 2
            )
            SELECT project_id::text, ts,
                   SUM(total)::text  AS total,
                   SUM(errors)::text AS errors
            FROM (SELECT * FROM rolled UNION ALL SELECT * FROM fresh) combined
            GROUP BY 1, 2
            -- ORDER BY the position, never an output alias: total is text here,
            -- and Postgres resolves an ORDER BY name against the select list
            -- first. Three defects of exactly that shape have shipped here.
            ORDER BY 2
        `),
    );
}

type PlainBucketRow = { project_id: string; ts: Date; total: string; errors: string };

function collapsePlain(rows: PlainBucketRow[]): EventBucket[] {
    return rows.map((r) => ({
        projectId: r.project_id,
        ts: new Date(r.ts),
        total: Number(r.total),
        errors: Number(r.errors),
    }));
}

/**
 * The same buckets, with counts per level.
 *
 * Only the project dashboard's stacked-area chart needs this, and it pays for it
 * — `jsonb_each_text(by_level)` parses JSON per row and multiplies rows by the
 * number of levels present. See `LevelledBucket` for the measurement.
 */
export async function eventBucketsByLevel(
    projectIds: string[],
    range: DateRange,
    bucketSecs: number,
    environments?: string[],
): Promise<LevelledBucket[]> {
    if (projectIds.length === 0) return [];
    const { from, to } = range;
    const ids = uuidArray(projectIds);

    const useRollup =
        !hasEnvFilter(environments) || (await envRollupUsable(projectIds, from));

    if (!useRollup) {
        return collapseLevelled(
            await db.execute<LevelBucketRow>(sql`
                SELECT
                    project_id::text,
                    ${bucketed(sql`timestamp`, bucketSecs)} AS ts,
                    level,
                    COUNT(*)::text AS cnt
                FROM events
                WHERE project_id = ANY(ARRAY[${ids}])
                  AND timestamp >= ${toTs(from)}
                  AND timestamp <  ${toTs(to)}
                  ${envCond(environments)}
                GROUP BY 1, 2, 3
                ORDER BY 2
            `),
        );
    }

    const boundary = (await rollupBoundary(projectIds)) ?? from;

    return collapseLevelled(
        await db.execute<LevelBucketRow>(sql`
            WITH rolled AS (
                SELECT
                    project_id,
                    ${bucketed(sql`minute`, bucketSecs)} AS ts,
                    key                  AS level,
                    SUM(value::int)::int AS n
                FROM event_rollup_minutes, jsonb_each_text(by_level)
                WHERE project_id = ANY(ARRAY[${ids}])
                  AND minute >= ${toTs(from)}
                  AND minute <  LEAST(${toTs(to)}, ${toTs(boundary)})
                  ${rollupEnvCond(environments)}
                GROUP BY 1, 2, 3
            ),
            fresh AS (
                SELECT
                    project_id,
                    ${bucketed(sql`timestamp`, bucketSecs)} AS ts,
                    level,
                    COUNT(*)::int AS n
                FROM events
                WHERE project_id = ANY(ARRAY[${ids}])
                  AND timestamp >= GREATEST(${toTs(from)}, ${toTs(boundary)})
                  AND timestamp <  ${toTs(to)}
                  ${envCond(environments)}
                GROUP BY 1, 2, 3
            )
            SELECT project_id::text, ts, level, SUM(n)::text AS cnt
            FROM (SELECT * FROM rolled UNION ALL SELECT * FROM fresh) combined
            GROUP BY 1, 2, 3
            ORDER BY 2
        `),
    );
}

type LevelBucketRow = { project_id: string; ts: Date; level: string; cnt: string };

/** Flat `(project, ts, level, count)` rows into one entry per project per bucket. */
function collapseLevelled(rows: LevelBucketRow[]): LevelledBucket[] {
    const byKey = new Map<string, LevelledBucket>();
    for (const row of rows) {
        const ts = new Date(row.ts);
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
 * Events in the **last completed minute**, per project.
 *
 * Its own tiny query, and that is the point. The rate used to be an average over
 * the page's range, derived from the bucket series — so at 30 days it divided a
 * month's total by 43,200 and called the answer "events / min". Asked for the
 * *current* rate instead, the buckets cannot supply it at all: at a 30-day range
 * `bucketSecs` is 86,400 and the minute simply is not in them.
 *
 * It cannot come from the rollup either, and not for want of coverage — the
 * rollup holds only **closed** minutes, and the minute this reports is the one
 * still filling. That is the same raw tail every other read unions in, asked for
 * on its own.
 *
 * Cheap by construction: a trailing 60 seconds on `(project_id, timestamp)`,
 * measured at ~1,900 rows on the staging corpus and single-digit milliseconds.
 *
 * `environments` is still supported and no longer passed by anything: its one
 * caller is the project layout, which renders `ProjectPulse` in the top bar and
 * cannot read `searchParams`. Kept because the parameter costs nothing and the
 * reading is per-environment the moment a caller can supply one.
 */
export async function eventsInLastMinute(
    projectIds: string[],
    environments?: string[],
): Promise<number> {
    if (projectIds.length === 0) return 0;

    const [row] = await db.execute<{ n: string }>(sql`
        SELECT COUNT(*)::text AS n
        FROM events
        WHERE project_id = ANY(ARRAY[${uuidArray(projectIds)}])
          AND timestamp >= now() - interval '1 minute'
          ${envCond(environments)}
    `);
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
 * Replaces `levelBreakdown` (one project, no environment filter) and
 * `getOrgLevelBreakdown` (many projects, filterable). The org version was
 * already the superset, so the merge is the project version disappearing.
 *
 * Filtered, this reads raw `events`, and that is a property of the table rather
 * than of its coverage: an environment filter needs the **joint** distribution
 * of level and environment, while the rollup stores the two as separate
 * marginals. "How many errors in production" is not answerable from them at any
 * grain. `eventRollup.ts` records why the joint is not stored — the cross
 * product would make every 30-day read walk a nested object over 43,200 rows
 * per project to serve a rare filter.
 */
export async function levelBreakdown(
    projectIds: string[],
    range: DateRange,
    environments?: string[],
): Promise<LevelCount[]> {
    if (projectIds.length === 0) return [];
    const { from, to } = range;
    const ids = uuidArray(projectIds);

    const useRollup =
        !hasEnvFilter(environments) || (await envRollupUsable(projectIds, from));

    if (!useRollup) {
        const rows = await db.execute<LevelQueryRow>(sql`
            SELECT level, COUNT(*)::text AS count
            FROM events
            WHERE project_id = ANY(ARRAY[${ids}])
              AND timestamp >= ${toTs(from)}
              AND timestamp <  ${toTs(to)}
              ${envCond(environments)}
            GROUP BY level
            -- ORDER BY the aggregate, never the output alias: count is text
            -- here, and Postgres resolves an ORDER BY name against the select
            -- list first, ranking 9 above 10. That defect shipped twice in this
            -- codebase and stayed invisible both times because the widget
            -- re-sorted on the client -- the data was wrong and the page looked
            -- right.
            ORDER BY COUNT(*) DESC
        `);
        return rows.map(toLevelCount);
    }

    const boundary = (await rollupBoundary(projectIds)) ?? from;

    const rows = await db.execute<LevelQueryRow>(sql`
        WITH rolled AS (
            SELECT key AS level, SUM(value::int)::int AS n
            FROM event_rollup_minutes, jsonb_each_text(by_level)
            WHERE project_id = ANY(ARRAY[${ids}])
              AND minute >= ${toTs(from)}
              AND minute <  LEAST(${toTs(to)}, ${toTs(boundary)})
              ${rollupEnvCond(environments)}
            GROUP BY key
        ),
        fresh AS (
            SELECT level, COUNT(*)::int AS n
            FROM events
            WHERE project_id = ANY(ARRAY[${ids}])
              AND timestamp >= GREATEST(${toTs(from)}, ${toTs(boundary)})
              AND timestamp <  ${toTs(to)}
              ${envCond(environments)}
            GROUP BY level
        )
        SELECT level, SUM(n)::text AS count
        FROM (SELECT * FROM rolled UNION ALL SELECT * FROM fresh) combined
        GROUP BY level
        ORDER BY SUM(n) DESC
    `);
    return rows.map(toLevelCount);
}

type LevelQueryRow = { level: string; count: string };

function toLevelCount(row: LevelQueryRow): LevelCount {
    return { level: row.level, count: Number(row.count) };
}

/**
 * One frequent message, and which project it belongs to.
 *
 * Merges `TopMessage` (project dashboard, no attribution) and `OrgTopError`
 * (overview, attributed). `projectId` is free on a single-project scope and is
 * what the org table needs, so it is always carried.
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
 * The most frequent messages in scope.
 *
 * Replaces `topMessages` (one project, every level, unattributed) and
 * `getOrgTopErrors` (many projects, errors only, attributed). The two queries
 * differed in scope, a level predicate, and whether they computed an owning
 * project — none of which is a reason for two implementations of the hardest
 * query on either dashboard.
 *
 * ## Two paths, chosen by coverage
 *
 * Where `event_template_rollup` covers the range, this groups by a `bigint`
 * fingerprint over pre-aggregated rows. Where it does not, it groups
 * `SUBSTRING(message, 1, 200)` over raw `events`.
 *
 * **The fallback is not a safety net that never fires.** Events ingested before
 * `template_hash` shipped carry no fingerprint and never will, so any range
 * reaching into that history takes it, and will until 30-day retention rolls
 * those events out. Deleting it the day the rollup worked would silently return
 * a list missing everything older than the deploy.
 *
 * An **environment filter also forces it**, and that is about the table's shape
 * rather than its coverage: `event_template_rollup` stores no environment, so a
 * filtered question is one it cannot answer at all rather than one it answers
 * slowly.
 *
 * Measured on staging, 8.9M events, 7 days: the raw form reads 4.5M rows and
 * hashes 1.13M groups in ~17 s; the rollup form reads ~899k rows and groups
 * ~18k (`PLAN.md` §16.3). Measured again 2026-08-25 on a 500k-event corpus, the
 * ratio inverts — the rollup holds 2.45 events per row there, so it barely
 * compresses and the raw path wins. Both numbers are real; which applies
 * depends on events-per-minute against template cardinality.
 */
export async function topMessages(
    projectIds: string[],
    range: DateRange,
    options: TopMessagesOptions = {},
): Promise<TopMessage[]> {
    if (projectIds.length === 0) return [];
    const { from, to } = range;
    const { levels, environments, limit = 10 } = options;

    if (!hasEnvFilter(environments)) {
        const coverage = await templateCoverageForProjects(projectIds);
        // `coverage.from === null` means every event carries a fingerprint, so
        // nothing sits below the rollup for the range to miss — whatever the
        // range is. Comparing against the start of the window instead is what
        // sent every 7d and 30d read to the fallback on a corpus younger than
        // the window, over a gap that contained no events at all.
        if (coverage && (coverage.from === null || from >= coverage.from)) {
            const boundary = to < coverage.to ? to : coverage.to;
            return topMessagesFromRollup(projectIds, from, to, boundary, levels, limit);
        }
    }

    return topMessagesFromEvents(projectIds, from, to, levels, environments, limit);
}

/**
 * `topMessages` served from the template rollup.
 *
 * Grouping by a `bigint` fingerprint rather than 200 characters of text is the
 * entire point: the sort disappears and the work stops scaling with the number
 * of events.
 *
 * The caller has already established that `range` sits inside coverage and that
 * no environment filter is active; this does not re-check, because the decision
 * needs the fallback branch and belongs where both are visible.
 */
async function topMessagesFromRollup(
    projectIds: string[],
    from: Date,
    to: Date,
    boundary: Date,
    levels: readonly EventLevel[] | undefined,
    limit: number,
): Promise<TopMessage[]> {
    const ids = uuidArray(projectIds);

    // What "how often" counts. Unrestricted it is every event on the template;
    // restricted it is the sum of the named levels' counters, and the HAVING
    // then drops templates that never occurred at one of them — otherwise a
    // widget labelled "top errors" would rank a template with a thousand info
    // lines and no errors at all.
    const totalExpr = levels
        ? sql.join(
              levels.map((l) => sql.raw(`n_${l}`)),
              sql` + `,
          )
        : sql`count`;
    const having = levels ? sql` HAVING SUM(${totalExpr}) > 0` : sql``;

    const rows = await db.execute<
        RollupLevelRow & { message: string; count: string; project_id: string; latest_at: Date }
    >(sql`
        WITH cells AS (
            -- Five int columns, so no lateral over jsonb and no JSON parse per
            -- row. That expansion measured 547 ms with 0% of it waiting on
            -- disk -- pure CPU, which is why the n_* columns exist.
            SELECT r.project_id,
                   r.template_hash,
                   SUM(r.count)::int   AS count,
                   SUM(r.n_debug)::int AS n_debug,
                   SUM(r.n_info)::int  AS n_info,
                   SUM(r.n_warn)::int  AS n_warn,
                   SUM(r.n_error)::int AS n_error,
                   SUM(r.n_fatal)::int AS n_fatal,
                   MAX(r.latest_at)    AS latest
            FROM event_template_rollup r
            WHERE r.project_id = ANY(ARRAY[${ids}])
              AND r.minute >= ${toTs(from)}
              AND r.minute <  ${toTs(boundary)}
            GROUP BY 1, 2

            UNION ALL

            -- The tail: at minute grain this is at most one minute of events,
            -- which is why the grain was chosen. At hour grain it would be up
            -- to ~114,000 rows on every read.
            SELECT e.project_id,
                   e.template_hash,
                   COUNT(*)::int,
                   COUNT(*) FILTER (WHERE e.level = 'debug')::int,
                   COUNT(*) FILTER (WHERE e.level = 'info')::int,
                   COUNT(*) FILTER (WHERE e.level = 'warn')::int,
                   COUNT(*) FILTER (WHERE e.level = 'error')::int,
                   COUNT(*) FILTER (WHERE e.level = 'fatal')::int,
                   MAX(e.timestamp)
            FROM events e
            WHERE e.project_id = ANY(ARRAY[${ids}])
              AND e.timestamp >= ${toTs(boundary)}
              AND e.timestamp <  ${toTs(to)}
              AND e.template_hash IS NOT NULL
            GROUP BY 1, 2
        ),
        per_project AS (
            SELECT project_id, template_hash,
                   SUM(n_debug)::int AS n_debug,
                   SUM(n_info)::int  AS n_info,
                   SUM(n_warn)::int  AS n_warn,
                   SUM(n_error)::int AS n_error,
                   SUM(n_fatal)::int AS n_fatal,
                   SUM(${totalExpr})::int AS total,
                   MAX(latest)       AS latest
            FROM cells
            GROUP BY 1, 2${having}
        ),
        per_template AS (
            SELECT template_hash,
                   SUM(n_debug)::int AS n_debug,
                   SUM(n_info)::int  AS n_info,
                   SUM(n_warn)::int  AS n_warn,
                   SUM(n_error)::int AS n_error,
                   SUM(n_fatal)::int AS n_fatal,
                   SUM(total)::int   AS total,
                   MAX(latest)       AS latest
            FROM per_project
            GROUP BY 1
            ORDER BY total DESC
            LIMIT ${limit}
        ),
        owner AS (
            -- Replaces mode() WITHIN GROUP (ORDER BY project_id), which picked
            -- the project contributing the most rows. Same answer, but an
            -- ordered-set aggregate forbids HashAggregate at any work_mem, and
            -- that cost 9.8 s on this query's sibling. The window runs over one
            -- row per (project, template) among the top N, which is tens.
            SELECT pp.template_hash, pp.project_id,
                   ROW_NUMBER() OVER (
                       PARTITION BY pp.template_hash
                       ORDER BY pp.total DESC, pp.project_id
                   ) AS rn
            FROM per_project pp
            JOIN per_template pt ON pt.template_hash = pp.template_hash
        )
        SELECT
            COALESCE(mt.template, '(unknown template)') AS message,
            t.total::text                               AS count,
            o.project_id::text                          AS project_id,
            t.latest                                    AS latest_at,
            t.n_debug, t.n_info, t.n_warn, t.n_error, t.n_fatal
        FROM per_template t
        JOIN owner o ON o.template_hash = t.template_hash AND o.rn = 1
        LEFT JOIN message_templates mt
               ON mt.project_id = o.project_id AND mt.template_hash = t.template_hash
        -- The int column, never the text alias above it: ordering by the alias
        -- sorts "9" after "10". That defect shipped three times here already,
        -- recorded in logging.md.
        ORDER BY t.total DESC
    `);

    return rows.map((r) => toTopMessage(r, r.project_id, levels));
}

/**
 * `topMessages` over raw `events`.
 *
 * The original implementation, kept because it is the only one that can answer
 * for events with no fingerprint and the only one that can answer under an
 * environment filter. See `topMessages` for when each runs.
 */
async function topMessagesFromEvents(
    projectIds: string[],
    from: Date,
    to: Date,
    levels: readonly EventLevel[] | undefined,
    environments: string[] | undefined,
    limit: number,
): Promise<TopMessage[]> {
    const levelCond = levels
        ? sql` AND level = ANY(ARRAY[${sql.join(
              levels.map((l) => sql`${l}`),
              sql`, `,
          )}])`
        : sql``;

    // Five plain counters instead of `mode() WITHIN GROUP (ORDER BY level)`.
    // That was an *ordered-set* aggregate, and one in the select list forbids
    // HashAggregate outright, at any work_mem -- it pinned this query to
    // sort-then-group over every matching row. Measured on staging at 8.9M
    // events over a 7-day range: 26,855 ms with it, 17,021 ms without, the plan
    // gaining Partial HashAggregate, one batch, no spill. COUNT(*) FILTER is an
    // ordinary aggregate and hashes fine. See PLAN.md 16.3.
    //
    // The same reasoning removed mode() WITHIN GROUP (ORDER BY project_id) from
    // the org query: the owning project is now a ROW_NUMBER window over the
    // per-project counts, which hashes.
    //
    // The level list is restated here rather than derived, because building it
    // from EVENT_LEVELS would mean generating aliases into raw SQL for a fixed
    // five-element enum. The drift that costs is covered instead by a test that
    // iterates EVENT_LEVELS and fails if any level is missing.
    const rows = await db.execute<
        RollupLevelRow & { message: string; count: string; project_id: string; latest_at: Date }
    >(sql`
        WITH per_project AS (
            SELECT
                SUBSTRING(message, 1, 200)                   AS message,
                project_id,
                COUNT(*)::int                                AS total,
                MAX(timestamp)                               AS latest,
                COUNT(*) FILTER (WHERE level = 'debug')::int AS n_debug,
                COUNT(*) FILTER (WHERE level = 'info')::int  AS n_info,
                COUNT(*) FILTER (WHERE level = 'warn')::int  AS n_warn,
                COUNT(*) FILTER (WHERE level = 'error')::int AS n_error,
                COUNT(*) FILTER (WHERE level = 'fatal')::int AS n_fatal
            FROM events
            WHERE project_id = ANY(ARRAY[${uuidArray(projectIds)}])
              AND timestamp >= ${toTs(from)}
              AND timestamp <  ${toTs(to)}
              ${levelCond}
              ${envCond(environments)}
            GROUP BY 1, 2
        ),
        per_message AS (
            SELECT message,
                   SUM(total)::int   AS total,
                   MAX(latest)       AS latest,
                   SUM(n_debug)::int AS n_debug,
                   SUM(n_info)::int  AS n_info,
                   SUM(n_warn)::int  AS n_warn,
                   SUM(n_error)::int AS n_error,
                   SUM(n_fatal)::int AS n_fatal
            FROM per_project
            GROUP BY 1
            ORDER BY total DESC
            LIMIT ${limit}
        ),
        owner AS (
            SELECT pp.message, pp.project_id,
                   ROW_NUMBER() OVER (
                       PARTITION BY pp.message
                       ORDER BY pp.total DESC, pp.project_id
                   ) AS rn
            FROM per_project pp
            JOIN per_message pm ON pm.message = pp.message
        )
        SELECT
            m.message,
            m.total::text      AS count,
            o.project_id::text AS project_id,
            m.latest           AS latest_at,
            m.n_debug, m.n_info, m.n_warn, m.n_error, m.n_fatal
        FROM per_message m
        JOIN owner o ON o.message = m.message AND o.rn = 1
        ORDER BY m.total DESC
    `);

    return rows.map((r) => toTopMessage(r, r.project_id, levels));
}

/**
 * Shape a query row into a {@link TopMessage}.
 *
 * When `levels` restricts the question, counters outside it are zeroed before
 * picking a dominant level. Without that, a template with a thousand `info`
 * lines and two `error`s would be badged `info` in a widget titled *top
 * errors* — the badge would describe the template, while the ranking beside it
 * described the errors.
 */
function toTopMessage(
    row: RollupLevelRow & { message: string; count: string; latest_at: Date },
    projectId: string,
    levels: readonly EventLevel[] | undefined,
): TopMessage {
    const counts = levelCounts(row);
    const restricted = levels
        ? Object.fromEntries(levels.map((l) => [l, counts[l] ?? 0]))
        : counts;

    return {
        message: row.message,
        count: Number(row.count),
        projectId,
        latestAt: new Date(row.latest_at),
        dominantLevel: pickDominantLevel(restricted),
    };
}

/** One event source and how many events came from it. */
export type SourceCount = {
    source: string;
    count: number;
};

/**
 * The newest minute whose rollup row predates `by_source`, or `null` when none
 * do.
 *
 * Migration 0013 gave every existing row `'{}'`, which is distinguishable from a
 * real result because every event has a source or `(unknown)` — a rebuilt row
 * always carries at least one key. Reading those rows would silently drop every
 * source older than the migration from a 30-day chart, which on this widget
 * looks exactly like a service that stopped logging.
 *
 * They form a contiguous band ending at the migration, and the job refills it
 * oldest-first, so `MAX` is exact rather than conservative: any range starting
 * after this instant is fully served by the rollup. Short ranges therefore work
 * immediately after deploy and long ones heal as the rebuild advances, with no
 * window in which anything is wrong.
 *
 * Scoped across every project asked about, and the `MAX` is what makes that
 * safe: it is the newest unrebuilt minute in the whole scope, so a range clearing
 * it clears it for all of them.
 */
async function sourceRollupFloor(projectIds: string[]): Promise<Date | null> {
    const [row] = await db.execute<{ newest: Date | null }>(sql`
        SELECT MAX(minute) AS newest
        FROM event_rollup_minutes
        WHERE project_id = ANY(ARRAY[${uuidArray(projectIds)}])
          AND by_source = '{}'::jsonb
    `);
    return row?.newest == null ? null : new Date(row.newest);
}

/**
 * Top N event sources by event count.
 *
 * **Two implementations, chosen by coverage**, like `topMessages`. This was the
 * last read on either dashboard still scanning raw `events` across the whole
 * range, and the measurement that ended its deferral is in `PLAN.md` §17:
 * 856 ms and 29–41% of its time waiting on disk, against 0% for every
 * rollup-backed query on the page.
 *
 * The fallback stays for the same reason `topMessages` keeps its own: rows
 * written before migration 0013 carry no `by_source`, and reading them anyway
 * would drop every source older than the deploy without raising anything. An
 * environment filter is served from the rollup where it can be — `by_source`
 * hangs off a row that now carries an `environment` key — and falls back with
 * everything else when `envRollupFloor` says the rollup cannot be trusted.
 */
export async function topSources(
    projectIds: string[],
    range: DateRange,
    options: { environments?: string[]; limit?: number } = {},
): Promise<SourceCount[]> {
    if (projectIds.length === 0) return [];
    const { from, to } = range;
    const { environments, limit = 10 } = options;
    const ids = uuidArray(projectIds);

    // Two floors answering different questions: `sourceRollupFloor` is about
    // `by_source` existing on the row at all, `envRollupUsable` about that row
    // being attributable to one environment. A filtered read needs both to say
    // yes; an unfiltered one only asks the first.
    const [boundary, floor, envUsable] = await Promise.all([
        rollupBoundary(projectIds),
        sourceRollupFloor(projectIds),
        hasEnvFilter(environments) ? envRollupUsable(projectIds, from) : Promise.resolve(true),
    ]);

    {
        if (envUsable && boundary && (floor === null || from > floor)) {
            const clamped = boundary < to ? boundary : to;
            const rows = await db.execute<SourceQueryRow>(sql`
                WITH cells AS (
                    SELECT s.key AS source, SUM(s.value::int)::int AS n
                    FROM event_rollup_minutes r, jsonb_each_text(r.by_source) s
                    WHERE r.project_id = ANY(ARRAY[${ids}])
                      AND r.minute >= ${toTs(from)}
                      AND r.minute <  ${toTs(clamped)}
                      ${rollupEnvCond(environments)}
                    GROUP BY 1

                    UNION ALL

                    -- The tail above the watermark, at most one minute of events.
                    SELECT COALESCE(e.source, '(unknown)'), COUNT(*)::int
                    FROM events e
                    WHERE e.project_id = ANY(ARRAY[${ids}])
                      AND e.timestamp >= ${toTs(clamped)}
                      AND e.timestamp <  ${toTs(to)}
                      ${envCond(environments)}
                    GROUP BY 1
                )
                SELECT source, SUM(n)::text AS count
                FROM cells
                GROUP BY source
                -- SUM(n), never the text alias: with a LIMIT a lexicographic
                -- sort drops the wrong ROWS, not merely reorders them.
                ORDER BY SUM(n) DESC
                LIMIT ${limit}
            `);
            return rows.map(toSourceCount);
        }
    }

    const rows = await db.execute<SourceQueryRow>(sql`
        SELECT COALESCE(source, '(unknown)') AS source, COUNT(*)::text AS count
        FROM events
        WHERE project_id = ANY(ARRAY[${ids}])
          AND timestamp >= ${toTs(from)}
          AND timestamp <  ${toTs(to)}
          ${envCond(environments)}
        GROUP BY COALESCE(source, '(unknown)')
        -- Same defect as levelBreakdown, and worse here: with a LIMIT, a
        -- lexicographic sort returns the wrong ROWS, not merely the wrong
        -- order. A source with 10 events ranked below every source with 2
        -- through 9 and fell off the end of the list.
        ORDER BY COUNT(*) DESC
        LIMIT ${limit}
    `);
    return rows.map(toSourceCount);
}

type SourceQueryRow = { source: string; count: string };

function toSourceCount(row: SourceQueryRow): SourceCount {
    return { source: row.source, count: Number(row.count) };
}

/** Raw row shape postgres.js returns for `events`' snake_case columns. */
type RawEventRow = {
    id: string;
    project_id: string;
    timestamp: Date;
    level: string;
    message: string;
    source: string | null;
    environment: string | null;
    release: string | null;
    user_id: string | null;
    session_id: string | null;
    request_id: string | null;
    trace_id: string | null;
    error_type: string | null;
    stack_trace: string | null;
    attributes: Record<string, unknown> | null;
    context: Record<string, unknown> | null;
    user_agent: string | null;
    ip: string | null;
};

/**
 * The most recent error and fatal events in scope.
 *
 * The one read here that returns **events rather than an aggregate**, which is
 * why it has no rollup path and never will: a summary of a minute cannot produce
 * the row a person clicks through to.
 *
 * Cheap regardless — measured at 0.84 ms. `(project_id, level, timestamp)` and a
 * `LIMIT` mean it touches ten rows, not the range.
 */
export async function recentErrors(
    projectIds: string[],
    range: DateRange,
    options: { environments?: string[]; limit?: number } = {},
): Promise<Event[]> {
    if (projectIds.length === 0) return [];
    const { from, to } = range;
    const { environments, limit = 10 } = options;

    const rows = await db.execute<RawEventRow>(sql`
        SELECT id, project_id, timestamp, level, message, source, environment,
               release, user_id, session_id, request_id, trace_id, error_type,
               stack_trace, attributes, context, user_agent, ip
        FROM events
        WHERE project_id = ANY(ARRAY[${uuidArray(projectIds)}])
          AND timestamp >= ${toTs(from)}
          AND timestamp <  ${toTs(to)}
          AND level IN ('error', 'fatal')
          ${envCond(environments)}
        ORDER BY timestamp DESC
        LIMIT ${limit}
    `);

    return rows.map((r) => ({
        id: r.id,
        projectId: r.project_id,
        timestamp: new Date(r.timestamp),
        level: r.level,
        message: r.message,
        source: r.source,
        environment: r.environment,
        release: r.release,
        userId: r.user_id,
        sessionId: r.session_id,
        requestId: r.request_id,
        traceId: r.trace_id,
        errorType: r.error_type,
        stackTrace: r.stack_trace,
        attributes: r.attributes,
        context: r.context,
        userAgent: r.user_agent,
        ip: r.ip,
    })) as Event[];
}

/**
 * True if any project in scope has ever received an event.
 *
 * Gates the onboarding screen, so it asks the cheap question first: one row per
 * minute is a far smaller haystack than the partitioned event table, and any
 * rollup row at all proves events existed. `events` is still consulted, because
 * a project whose first event arrived in the last minute has no rollup row yet
 * and is emphatically not empty — showing it the onboarding screen would be the
 * worst possible moment to do so.
 *
 * Measured at 0.79 ms, which is why it is the one read the caches skip: the
 * single moment its answer changes is the single moment a stale "no events yet"
 * would be worst.
 */
export async function hasAnyEvents(projectIds: string[]): Promise<boolean> {
    if (projectIds.length === 0) return false;
    const ids = uuidArray(projectIds);

    const [row] = await db.execute<{ has_events: boolean }>(sql`
        SELECT (
            EXISTS (
                SELECT 1 FROM event_rollup_minutes
                WHERE project_id = ANY(ARRAY[${ids}]) LIMIT 1
            )
            OR
            EXISTS (
                SELECT 1 FROM events
                WHERE project_id = ANY(ARRAY[${ids}]) LIMIT 1
            )
        ) AS has_events
    `);
    return row?.has_events ?? false;
}

/**
 * Everything about a project that the rollup can answer: counts and the
 * environments it used. Cheap — a few milliseconds even at millions of rows.
 *
 * Split from the top message on 2026-08-20. They used to be one type returned
 * by one function, which meant one promise, which meant the KPI row waited
 * ~954 ms for a message aggregation it does not display. See
 * `topMessagePerProject` for the other half.
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
 * Counts and environments per project — the rollup-backed half of what used to
 * be `getProjectSummaries`.
 *
 * **Why this is its own function.** Measured on staging: the statistics and
 * environment queries cost ~8 ms and ~23 ms, and the per-project top message
 * cost **954 ms**. All three lived in one `Promise.all` behind one promise, so
 * every consumer of any of them waited for the slowest — including the KPI row,
 * whose headline numbers come entirely from the rollup and never touch a
 * message. Splitting makes nothing faster; it stops the cheap half being held
 * by the expensive one (`PLAN.md` §16.1 Stage E).
 */
export async function projectStats(
    projectIds: string[],
    range: DateRange,
    environments?: string[],
): Promise<Map<string, ProjectStats>> {
    if (projectIds.length === 0) return new Map();
    const { from, to } = range;
    const ids = uuidArray(projectIds);

    // Until 2026-08-25 an environment filter put `errorCount` beyond the
    // rollup's reach: `by_env` gave totals per environment, `by_level` totals
    // per level, and "errors in production" needs both at once. `environment`
    // is now a key column, so the joint question is one `WHERE` clause and the
    // filtered read is served from the rollup like every other.
    //
    // It still asks first. A minute that folded environments into `(other)`, or
    // one written before the key existed, cannot answer a filtered question —
    // see `envRollupFloor`.
    //
    // There is no level filter to consider since 2026-08-20 — the chips that
    // fed one were removed (see `DashboardFilterBar.tsx`), which is what lets the
    // rollup branch read `total` and `errors` straight off the row instead of
    // unrolling `by_level` per minute.
    const useRollup =
        !hasEnvFilter(environments) || (await envRollupUsable(projectIds, from));
    const boundary = (await rollupBoundary(projectIds)) ?? from;

    const [statsRows, envRows] = await Promise.all([
        useRollup
            ? db.execute<{ project_id: string; total: string; error_count: string }>(sql`
                WITH rolled AS (
                    SELECT project_id, SUM(total)::int AS total, SUM(errors)::int AS errors
                    FROM event_rollup_minutes
                    WHERE project_id = ANY(ARRAY[${ids}])
                      AND minute >= ${toTs(from)}
                      AND minute <  LEAST(${toTs(to)}, ${toTs(boundary)})
                      ${rollupEnvCond(environments)}
                    GROUP BY project_id
                ),
                fresh AS (
                    SELECT
                        project_id,
                        COUNT(*)::int                                            AS total,
                        COUNT(*) FILTER (WHERE level IN ('error', 'fatal'))::int AS errors
                    FROM events
                    WHERE project_id = ANY(ARRAY[${ids}])
                      AND timestamp >= GREATEST(${toTs(from)}, ${toTs(boundary)})
                      AND timestamp <  ${toTs(to)}
                      ${envCond(environments)}
                    GROUP BY project_id
                )
                SELECT project_id::text, SUM(total)::text AS total, SUM(errors)::text AS error_count
                FROM (SELECT * FROM rolled UNION ALL SELECT * FROM fresh) combined
                GROUP BY project_id
                HAVING SUM(total) > 0
            `)
            : db.execute<{ project_id: string; total: string; error_count: string }>(sql`
                SELECT
                    project_id::text,
                    COUNT(*)::text                                        AS total,
                    COUNT(*) FILTER (WHERE level IN ('error', 'fatal'))::text AS error_count
                FROM events
                WHERE project_id = ANY(ARRAY[${ids}])
                  AND timestamp >= ${toTs(from)}
                  AND timestamp <  ${toTs(to)}
                  ${envCond(environments)}
                GROUP BY project_id
            `),
        // Environments each project used in this range. Takes no filters, and
        // never did — the pills describe the project, not the current view.
        //
        // Reads the environment **key column** since 2026-08-25; it read the
        // by_env jsonb marginal before, which no longer exists. The reserved
        // labels are excluded below rather than shown: (all) names no
        // environment, and (other) names several.
        //
        // Returns a real array. An earlier version joined with `STRING_AGG(…,
        // ',')` and split on "," in TypeScript, which turned an environment
        // named "eu,prod" into two — reachable through the public ingest API,
        // since `environment` is validated only as a string.
        db.execute<{ project_id: string; envs: string[] }>(sql`
            WITH rolled AS (
                SELECT project_id, environment AS env
                FROM event_rollup_minutes
                WHERE project_id = ANY(ARRAY[${ids}])
                  AND minute >= ${toTs(from)}
                  AND minute <  LEAST(${toTs(to)}, ${toTs(boundary)})
            ),
            fresh AS (
                SELECT project_id, COALESCE(environment, '(unset)') AS env
                FROM events
                WHERE project_id = ANY(ARRAY[${ids}])
                  AND timestamp >= GREATEST(${toTs(from)}, ${toTs(boundary)})
                  AND timestamp <  ${toTs(to)}
            )
            SELECT project_id::text, ARRAY_AGG(DISTINCT env) AS envs
            FROM (SELECT * FROM rolled UNION ALL SELECT * FROM fresh) combined
            -- Matches the old "environment IS NOT NULL": an event without an
            -- environment contributes no pill. (all) and (other) are the
            -- rollup reserved labels and name no single environment.
            WHERE env NOT IN ('(unset)', '(all)', '(other)')
            GROUP BY project_id
        `),
    ]);

    const envMap = new Map<string, string[]>();
    for (const row of envRows) {
        // Sorted here rather than in SQL so the order stays byte-wise, as it
        // was when this came from a JS `.sort()` — a database collation orders
        // punctuation differently, and `(other)` would move.
        envMap.set(row.project_id, [...row.envs].sort());
    }

    const map = new Map<string, ProjectStats>();
    for (const row of statsRows) {
        map.set(row.project_id, {
            projectId: row.project_id,
            totalEvents: Number(row.total),
            errorCount: Number(row.error_count),
            environments: envMap.get(row.project_id) ?? [],
        });
    }
    return map;
}

/**

 * `topMessagePerProject` served from the template rollup.
 *
 * Grouping by a `bigint` fingerprint over pre-aggregated rows instead of by 120
 * characters of text over raw events. Measured on staging 2026-08-22, this was
 * the overview's most expensive query at **4,931 ms** — more than the rest of
 * the page put together.
 *
 * No `mode() WITHIN GROUP` here either. It is an ordered-set aggregate, and one
 * in the select list makes `HashAggregate` unavailable at any `work_mem`, which
 * cost the dashboard's version 37% before it was removed. The level badge comes
 * from summed `by_level` counts and `pickDominantLevel`, exactly as on the
 * dashboard.
 *
 * The caller has already established that the range sits inside coverage and
 * that **no environment filter is active** — the rollup does not store
 * environment, so it cannot answer a filtered question at all.
 */
async function topMessagePerProjectFromRollup(
    projectIds: string[],
    from: Date,
    to: Date,
    boundary: Date,
): Promise<Map<string, ProjectTopMessage>> {
    const rows = await db.execute<
        RollupLevelRow & { project_id: string; message: string }
    >(sql`
        WITH cells AS (
            -- n_error / n_fatal instead of a lateral over by_level. The jsonb
            -- form also had to filter l.key IN ('error','fatal') *after*
            -- expanding every row into five; here the other three levels are
            -- simply columns nobody selects.
            SELECT r.project_id, r.template_hash,
                   SUM(r.n_error)::int AS n_error,
                   SUM(r.n_fatal)::int AS n_fatal
            FROM event_template_rollup r
            WHERE r.project_id = ANY(ARRAY[${uuidArray(projectIds)}])
              AND r.minute >= ${toTs(from)}
              AND r.minute <  ${toTs(boundary)}
            GROUP BY 1, 2

            UNION ALL

            SELECT e.project_id, e.template_hash,
                   COUNT(*) FILTER (WHERE e.level = 'error')::int,
                   COUNT(*) FILTER (WHERE e.level = 'fatal')::int
            FROM events e
            WHERE e.project_id = ANY(ARRAY[${uuidArray(projectIds)}])
              AND e.timestamp >= ${toTs(boundary)}
              AND e.timestamp <  ${toTs(to)}
              AND e.template_hash IS NOT NULL
              AND e.level IN ('error', 'fatal')
            GROUP BY 1, 2
        ),
        totals AS (
            SELECT project_id, template_hash,
                   SUM(n_error)::int AS n_error,
                   SUM(n_fatal)::int AS n_fatal,
                   SUM(n_error + n_fatal)::int AS total
            FROM cells
            GROUP BY 1, 2
            HAVING SUM(n_error + n_fatal) > 0
        ),
        ranked AS (
            -- The window runs over one row per (project, template) -- a few
            -- thousand -- not over the millions the grouping above consumed.
            SELECT project_id, template_hash, n_error, n_fatal,
                   ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY total DESC) AS rn
            FROM totals
        )
        -- One row per (project, template) reaches here, so there is nothing
        -- left to re-aggregate and the self-join the jsonb form needed is gone.
        SELECT
            rk.project_id::text                         AS project_id,
            COALESCE(mt.template, '(unknown template)') AS message,
            0 AS n_debug, 0 AS n_info, 0 AS n_warn,
            rk.n_error, rk.n_fatal
        FROM ranked rk
        LEFT JOIN message_templates mt
          ON mt.project_id = rk.project_id AND mt.template_hash = rk.template_hash
        WHERE rk.rn = 1
    `);

    const map = new Map<string, ProjectTopMessage>();
    for (const row of rows) {
        map.set(row.project_id, {
            message: row.message,
            // Only error and fatal are counted here -- this widget answers
            // "worst error", not "most frequent message" -- so the other three
            // are selected as literal zeros to keep one row shape across both
            // rollup readers. The HAVING above guarantees one of the two is
            // positive, which is what stops pickDominantLevel throwing.
            level: pickDominantLevel(levelCounts(row)),
        });
    }
    return map;
}

/**
 * The most frequent error message per project.
 *
 * **The expensive half.** ~954 ms on staging at 1.3M events, against ~30 ms for
 * everything in `projectStats`. It groups by `SUBSTRING(message, 1, 120)`
 * over raw `events`, which the rollup cannot serve at any grain — 168k distinct
 * messages per 500k events, and merging per-minute top-N lists is approximate
 * in a way that would produce plausible wrong numbers.
 *
 * Note it does **not** read `rollupBoundary`: it never touches the summary
 * table, so unlike `projectStats` it has no query to wait for first. The
 * split removed that dependency as a side effect.
 *
 * Rendered behind its own `Suspense` boundary, so the projects table paints its
 * numbers immediately and fills this column in when the query lands.
 */
export async function topMessagePerProject(
    projectIds: string[],
    range: DateRange,
    environments?: string[],
): Promise<Map<string, ProjectTopMessage>> {
    if (projectIds.length === 0) return new Map();
    const { from, to } = range;

    // The rollup stores no environment, so a filtered question cannot be
    // answered from it at all — not slowly, not approximately. That is the one
    // condition here that is about the table's shape rather than its coverage.
    const unfiltered = !environments || environments.length === 0;
    if (unfiltered) {
        const coverage = await templateCoverageForProjects(projectIds);
        if (coverage && (coverage.from === null || from >= coverage.from)) {
            const boundary = to < coverage.to ? to : coverage.to;
            return topMessagePerProjectFromRollup(projectIds, from, to, boundary);
        }
    }

    const rows = await db.execute<{
        project_id: string;
        message: string;
        dominant_level: string;
    }>(sql`
        WITH ranked AS (
            SELECT
                project_id::text,
                SUBSTRING(message, 1, 120)                          AS message,
                mode() WITHIN GROUP (ORDER BY level)                AS dominant_level,
                ROW_NUMBER() OVER (
                    PARTITION BY project_id
                    ORDER BY COUNT(*) DESC
                )                                                   AS rn
            FROM events
            WHERE project_id = ANY(ARRAY[${uuidArray(projectIds)}])
              AND timestamp >= ${toTs(from)}
              AND timestamp <  ${toTs(to)}
              AND level IN ('error', 'fatal')
              ${envCond(environments)}
            GROUP BY project_id, SUBSTRING(message, 1, 120)
        )
        SELECT project_id, message, dominant_level
        FROM   ranked
        WHERE  rn = 1
    `);

    const map = new Map<string, ProjectTopMessage>();
    for (const row of rows) {
        map.set(row.project_id, { message: row.message, level: row.dominant_level });
    }
    return map;
}

/**
 * The environments offered by the overview's filter bar.
 *
 * Reads `project_environments`, a registry maintained at ingest, rather than
 * scanning `events`. The previous implementation read 30 days of events on
 * every page load to produce a list of a handful of values, and
 * `pg_stat_statements` put that at **13.4% of the page's total database time**
 * (2026-08-20). The 30-day window is preserved through `last_seen_at`, so a
 * decommissioned environment still ages out of the list.
 *
 * Deliberately unchanged: this ignores the range selected in the filter bar,
 * exactly as the scan it replaces did. The list is "what this organization
 * uses", not "what appeared in the last hour" — narrowing it to the range
 * would make an option vanish the moment you selected a window in which it had
 * no events.
 */
export async function environmentsInUse(projectIds: string[]): Promise<string[]> {
    if (projectIds.length === 0) return [];

    const rows = await db.execute<{ environment: string }>(sql`
        SELECT DISTINCT COALESCE(environment, '(unset)') AS environment
        FROM project_environments
        WHERE project_id = ANY(ARRAY[${uuidArray(projectIds)}])
          AND last_seen_at >= NOW() - INTERVAL '30 days'
        ORDER BY environment
    `);
    return rows.map((r) => r.environment);
}
