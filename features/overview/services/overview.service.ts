import { sql } from "drizzle-orm";
import { db } from "@/core/db/client";
import { rollupBoundary } from "@/shared/services/rollup-boundary.service";

export type DateRange = { from: Date; to: Date };

/**
 * Everything about a project that the rollup can answer: counts and the
 * environments it used. Cheap — a few milliseconds even at millions of rows.
 *
 * Split from the top message on 2026-08-20. They used to be one type returned
 * by one function, which meant one promise, which meant the KPI row waited
 * ~954 ms for a message aggregation it does not display. See
 * `getProjectTopMessages` for the other half.
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

export type ProjectRow = {
    project: { id: string; slug: string; name: string };
    totalEvents: number;
    errorCount: number;
    environments: string[];
    firingAlertsCount: number;
    enabledAlertsCount: number;
};

export type OrgLevelCount = {
    level: string;
    count: number;
};

export type OrgTopError = {
    message: string;
    count: number;
    projectId: string;
    dominantLevel: string;
    latestAt: Date;
};

export type OrgEventBucket = {
    projectId: string;
    ts: Date;
    count: number;
    errorCount: number;
};

function toTs(d: Date) {
    return sql`${d.toISOString()}::timestamptz`;
}

function uuidArray(ids: string[]) {
    return sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);
}

function envCond(environments?: string[]) {
    if (!environments || environments.length === 0) return sql``;
    return sql` AND environment = ANY(ARRAY[${sql.join(environments.map((e) => sql`${e}`), sql`, `)}])`;
}

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
export async function getProjectStats(
    projectIds: string[],
    range: DateRange,
    environments?: string[],
): Promise<Map<string, ProjectStats>> {
    if (projectIds.length === 0) return new Map();
    const { from, to } = range;

    const boundary = (await rollupBoundary(projectIds)) ?? from;

    // An environment filter puts `errorCount` beyond the rollup's reach:
    // `by_env` gives totals per environment, `by_level` gives totals per level,
    // and "errors in production" needs both at once. That read stays on raw
    // events.
    //
    // There is no level filter to consider since 2026-08-20 — the chips that
    // fed one were removed (see `OverviewFilterBar.tsx`), which is what lets
    // the rollup branch below read `total` and `errors` straight off the
    // summary row instead of unrolling `by_level` per minute.
    const hasEnvFilter = !!environments && environments.length > 0;

    const [statsRows, envRows] = await Promise.all([
        hasEnvFilter
            ? db.execute<{ project_id: string; total: string; error_count: string }>(sql`
                SELECT
                    project_id::text,
                    COUNT(*)::text                                        AS total,
                    COUNT(*) FILTER (WHERE level IN ('error', 'fatal'))::text AS error_count
                FROM events
                WHERE project_id = ANY(ARRAY[${uuidArray(projectIds)}])
                  AND timestamp >= ${toTs(from)}
                  AND timestamp <  ${toTs(to)}
                  ${envCond(environments)}
                GROUP BY project_id
            `)
            : db.execute<{ project_id: string; total: string; error_count: string }>(sql`
                WITH rolled AS (
                    SELECT project_id, SUM(total)::int AS total, SUM(errors)::int AS errors
                    FROM event_rollup_minutes
                    WHERE project_id = ANY(ARRAY[${uuidArray(projectIds)}])
                      AND minute >= ${toTs(from)}
                      AND minute <  LEAST(${toTs(to)}, ${toTs(boundary)})
                    GROUP BY project_id
                ),
                fresh AS (
                    SELECT
                        project_id,
                        COUNT(*)::int                                            AS total,
                        COUNT(*) FILTER (WHERE level IN ('error', 'fatal'))::int AS errors
                    FROM events
                    WHERE project_id = ANY(ARRAY[${uuidArray(projectIds)}])
                      AND timestamp >= GREATEST(${toTs(from)}, ${toTs(boundary)})
                      AND timestamp <  ${toTs(to)}
                    GROUP BY project_id
                )
                SELECT project_id::text, SUM(total)::text AS total, SUM(errors)::text AS error_count
                FROM (SELECT * FROM rolled UNION ALL SELECT * FROM fresh) combined
                GROUP BY project_id
                HAVING SUM(total) > 0
            `),
        // Environments each project used in this range. Takes no filters, and
        // never did — the pills describe the project, not the current view.
        //
        // Returns a real array. The previous version joined with `STRING_AGG(…,
        // ',')` and split on "," in TypeScript, which turned an environment
        // named "eu,prod" into two — a bug reachable through the public ingest
        // API, since `environment` is validated only as a string.
        db.execute<{ project_id: string; envs: string[] }>(sql`
            WITH rolled AS (
                SELECT project_id, key AS env
                FROM event_rollup_minutes, jsonb_each_text(by_env)
                WHERE project_id = ANY(ARRAY[${uuidArray(projectIds)}])
                  AND minute >= ${toTs(from)}
                  AND minute <  LEAST(${toTs(to)}, ${toTs(boundary)})
            ),
            fresh AS (
                SELECT project_id, COALESCE(environment, '(unset)') AS env
                FROM events
                WHERE project_id = ANY(ARRAY[${uuidArray(projectIds)}])
                  AND timestamp >= GREATEST(${toTs(from)}, ${toTs(boundary)})
                  AND timestamp <  ${toTs(to)}
            )
            SELECT project_id::text, ARRAY_AGG(DISTINCT env) AS envs
            FROM (SELECT * FROM rolled UNION ALL SELECT * FROM fresh) combined
            -- Matches the old "environment IS NOT NULL": an event without an
            -- environment contributes no pill.
            WHERE env <> '(unset)'
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
 * The most frequent error message per project.
 *
 * **The expensive half.** ~954 ms on staging at 1.3M events, against ~30 ms for
 * everything in `getProjectStats`. It groups by `SUBSTRING(message, 1, 120)`
 * over raw `events`, which the rollup cannot serve at any grain — 168k distinct
 * messages per 500k events, and merging per-minute top-N lists is approximate
 * in a way that would produce plausible wrong numbers.
 *
 * Note it does **not** read `rollupBoundary`: it never touches the summary
 * table, so unlike `getProjectStats` it has no query to wait for first. The
 * split removed that dependency as a side effect.
 *
 * Rendered behind its own `Suspense` boundary, so the projects table paints its
 * numbers immediately and fills this column in when the query lands.
 */
export async function getProjectTopMessages(
    projectIds: string[],
    range: DateRange,
    environments?: string[],
): Promise<Map<string, ProjectTopMessage>> {
    if (projectIds.length === 0) return new Map();
    const { from, to } = range;

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

export async function getOrgLevelBreakdown(
    projectIds: string[],
    range: DateRange,
    environments?: string[],
): Promise<OrgLevelCount[]> {
    if (projectIds.length === 0) return [];
    const { from, to } = range;

    // An environment filter needs the *joint* distribution of level and
    // environment. The rollup stores the two as separate marginals, so it
    // cannot answer "how many errors in production" — that read goes to raw
    // events. See the note on `event_rollup_minutes` for why the joint is not
    // stored: it would make every long-range read walk a nested object.
    const hasEnvFilter = !!environments && environments.length > 0;

    if (hasEnvFilter) {
        const rows = await db.execute<{ level: string; count: string }>(sql`
            SELECT level, COUNT(*)::text AS count
            FROM events
            WHERE project_id = ANY(ARRAY[${uuidArray(projectIds)}])
              AND timestamp >= ${toTs(from)}
              AND timestamp <  ${toTs(to)}
              ${envCond(environments)}
            GROUP BY level
            -- ORDER BY COUNT(*), not the output alias: that alias is text, so
            -- Postgres would sort it lexicographically and rank 9 above 10.
            ORDER BY COUNT(*) DESC
        `);
        return rows.map((r) => ({ level: r.level, count: Number(r.count) }));
    }

    const boundary = (await rollupBoundary(projectIds)) ?? from;

    const rows = await db.execute<{ level: string; count: string }>(sql`
        WITH rolled AS (
            SELECT key AS level, SUM(value::int)::int AS n
            FROM event_rollup_minutes, jsonb_each_text(by_level)
            WHERE project_id = ANY(ARRAY[${uuidArray(projectIds)}])
              AND minute >= ${toTs(from)}
              AND minute <  LEAST(${toTs(to)}, ${toTs(boundary)})
            GROUP BY key
        ),
        fresh AS (
            SELECT level, COUNT(*)::int AS n
            FROM events
            WHERE project_id = ANY(ARRAY[${uuidArray(projectIds)}])
              AND timestamp >= GREATEST(${toTs(from)}, ${toTs(boundary)})
              AND timestamp <  ${toTs(to)}
            GROUP BY level
        )
        SELECT level, SUM(n)::text AS count
        FROM (SELECT * FROM rolled UNION ALL SELECT * FROM fresh) combined
        GROUP BY level
        ORDER BY SUM(n) DESC
    `);
    return rows.map((r) => ({ level: r.level, count: Number(r.count) }));
}

export async function getOrgTopErrors(
    projectIds: string[],
    range: DateRange,
    environments?: string[],
    limit = 5,
): Promise<OrgTopError[]> {
    if (projectIds.length === 0) return [];
    const { from, to } = range;

    // Fixed, not parameterised. Until 2026-08-20 a caller-supplied level list
    // could widen this to any levels at all — so the widget labelled "top
    // errors" would happily return debug lines. The only caller that passed
    // one was the overview's level filter, now removed.
    const lc = sql` AND level IN ('error', 'fatal')`;

    const rows = await db.execute<{
        message: string;
        count: string;
        project_id: string;
        dominant_level: string;
        latest_at: Date;
    }>(sql`
        SELECT
            SUBSTRING(message, 1, 200)                                AS message,
            COUNT(*)::text                                            AS count,
            mode() WITHIN GROUP (ORDER BY project_id::text)          AS project_id,
            mode() WITHIN GROUP (ORDER BY level)                      AS dominant_level,
            MAX(timestamp)                                            AS latest_at
        FROM events
        WHERE project_id = ANY(ARRAY[${uuidArray(projectIds)}])
          AND timestamp >= ${toTs(from)}
          AND timestamp <  ${toTs(to)}
          ${lc}
          ${envCond(environments)}
        GROUP BY SUBSTRING(message, 1, 200)
        -- ORDER BY COUNT(*), not the output alias: that alias is text, so
        -- Postgres would sort it lexicographically ("9" > "10") and the LIMIT
        -- below would then return the wrong rows, not merely the right rows in
        -- the wrong order.
        ORDER BY COUNT(*) DESC
        LIMIT ${limit}
    `);

    return rows.map((r) => ({
        message: r.message,
        count: Number(r.count),
        projectId: r.project_id,
        dominantLevel: r.dominant_level,
        latestAt: new Date(r.latest_at),
    }));
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
export async function getOrgEnvironments(projectIds: string[]): Promise<string[]> {
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

/**
 * Event volume per bucket, per project.
 *
 * Reads `event_rollup_minutes` for minutes the rollup has closed and raw
 * `events` for everything after — the "real-time" half. Without that union the
 * chart would always be missing its most recent minute, which on a logging tool
 * is the minute someone is actually watching.
 *
 * Bucketing is done on the union rather than in the rollup, because the widths
 * the UI asks for (60 s to 1 day) are all multiples of the rollup's minute
 * grain. Storing anything coarser would fix the chart's resolution at build
 * time.
 */
export async function getOrgEventBuckets(
    projectIds: string[],
    range: DateRange,
    bucketSecs = 3600,
): Promise<OrgEventBucket[]> {
    if (projectIds.length === 0) return [];
    const { from, to } = range;

    // `from` when nothing is rolled up: the rollup half then selects no rows
    // and the raw half covers the whole range, which is exactly the behaviour
    // before this table existed.
    const boundary = (await rollupBoundary(projectIds)) ?? from;

    const rows = await db.execute<{ project_id: string; ts: string; count: string; error_count: string }>(sql`
        WITH rolled AS (
            SELECT project_id, minute AS ts, total, errors
            FROM event_rollup_minutes
            WHERE project_id = ANY(ARRAY[${uuidArray(projectIds)}])
              AND minute >= ${toTs(from)}
              AND minute <  LEAST(${toTs(to)}, ${toTs(boundary)})
        ),
        fresh AS (
            SELECT
                project_id,
                date_trunc('minute', timestamp)                          AS ts,
                COUNT(*)::int                                            AS total,
                COUNT(*) FILTER (WHERE level IN ('error', 'fatal'))::int AS errors
            FROM events
            WHERE project_id = ANY(ARRAY[${uuidArray(projectIds)}])
              AND timestamp >= GREATEST(${toTs(from)}, ${toTs(boundary)})
              AND timestamp <  ${toTs(to)}
            GROUP BY 1, 2
        )
        SELECT
            project_id::text,
            to_timestamp(
                floor(extract(epoch from ts) / ${bucketSecs}) * ${bucketSecs}
            )::timestamptz AS ts,
            SUM(total)::text  AS count,
            SUM(errors)::text AS error_count
        FROM (SELECT * FROM rolled UNION ALL SELECT * FROM fresh) combined
        GROUP BY project_id, 2
        ORDER BY 2
    `);

    return rows.map((r) => ({
        projectId: r.project_id,
        ts: new Date(r.ts),
        count: Number(r.count),
        errorCount: Number(r.error_count),
    }));
}
