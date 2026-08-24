import { sql } from "drizzle-orm";
import { db } from "@/core/db/client";
import { rollupState } from "@/core/db/schema";

/**
 * Building and maintaining `event_rollup_minutes`.
 *
 * Lives beside the ingest path rather than beside a dashboard because the
 * watermark it depends on is written at ingest, and because it is maintenance
 * of the event store — the same reason `partman-maintenance.job.ts` is here.
 * Readers query the table directly; nothing imports across features.
 */

/**
 * Environments kept per minute before the rest are folded into `(other)`.
 *
 * `environment` is client-supplied and validated only as a string of at most
 * 128 characters, so a project sending a unique value per deploy would grow the
 * JSON without bound. The cap turns that from unbounded growth into a fixed
 * ceiling; twenty is far above what a real project uses and far below what
 * would make the row expensive to read.
 */
export const ENVIRONMENT_KEY_CAP = 20;

/**
 * The same cap for `source`, and the same reason.
 *
 * A separate constant rather than one shared `KEY_CAP`: they happen to agree
 * today, and tying them together would mean a future change to one silently
 * moving the other. Sources are in practice fewer than environments, so if
 * these ever diverge it will be this one going down.
 */
export const SOURCE_KEY_CAP = 20;

/**
 * How much history one run may rebuild.
 *
 * Catch-up has to be bounded, or the first run after the migration — which
 * starts at the oldest event — would aggregate the entire table in a single
 * job while the schedule keeps firing. One day per run makes a 30-day backfill
 * take thirty minutes of background work and each individual run predictable.
 */
export const MAX_CATCHUP_MINUTES = 24 * 60;

/**
 * Overlap re-processed on every run.
 *
 * The most recent minute may still be filling when a run starts, and clocks
 * between the app and the database are not identical. Redoing two minutes
 * costs almost nothing and removes both problems.
 */
const OVERLAP_MINUTES = 2;

export interface RollupRunResult {
    projectId: string;
    from: Date;
    to: Date;
    /** True when the watermark had further to go than one run may cover. */
    hasMore: boolean;
}

/**
 * Marks a project as needing its rollup rebuilt from `oldestTimestamp`.
 *
 * Called from the ingest path. `LEAST` matters: a batch carrying a three-day-old
 * event must pull the watermark back, and a later batch of fresh events must not
 * push it forward again before the job has caught up.
 */
export async function markRollupDirty(projectId: string, oldestTimestamp: Date): Promise<void> {
    await db
        .insert(rollupState)
        .values({ projectId, refreshFrom: oldestTimestamp })
        .onConflictDoUpdate({
            target: rollupState.projectId,
            set: { refreshFrom: sql`LEAST(${rollupState.refreshFrom}, EXCLUDED.refresh_from)` },
        });
}

/** Projects with a watermark behind the current minute, oldest first. */
export async function projectsNeedingRollup(): Promise<Array<{ projectId: string; refreshFrom: Date }>> {
    const rows = await db.execute<{ project_id: string; refresh_from: Date }>(sql`
        SELECT project_id::text, refresh_from
        FROM rollup_state
        WHERE refresh_from < date_trunc('minute', now())
        ORDER BY refresh_from
    `);
    return rows.map((r) => ({ projectId: r.project_id, refreshFrom: new Date(r.refresh_from) }));
}

/**
 * Rebuilds one project's rollup rows for the window starting at its watermark.
 *
 * Delete-then-insert rather than upsert, because a minute whose events have
 * been dropped by retention must lose its row. An upsert would leave the stale
 * count behind forever, and the discrepancy would be invisible: the number
 * would simply be wrong.
 *
 * Only **closed** minutes are materialised. The current minute is still
 * filling, and a figure that changes under the reader is exactly what this
 * table exists to avoid.
 */
export async function rebuildRollupForProject(
    projectId: string,
    refreshFrom: Date,
): Promise<RollupRunResult> {
    const rows = await db.execute<{ from_ts: Date; to_ts: Date; has_more: boolean }>(sql`
        SELECT
            date_trunc('minute', ${refreshFrom.toISOString()}::timestamptz)          AS from_ts,
            LEAST(
                date_trunc('minute', ${refreshFrom.toISOString()}::timestamptz)
                    + (${MAX_CATCHUP_MINUTES} || ' minutes')::interval,
                date_trunc('minute', now())
            )                                                                        AS to_ts,
            date_trunc('minute', ${refreshFrom.toISOString()}::timestamptz)
                + (${MAX_CATCHUP_MINUTES} || ' minutes')::interval
                < date_trunc('minute', now())                                        AS has_more
    `);

    const { from_ts, to_ts, has_more } = rows[0];
    const from = new Date(from_ts);
    const to = new Date(to_ts);

    if (from >= to) {
        return { projectId, from, to, hasMore: false };
    }

    await db.transaction(async (tx) => {
        await tx.execute(sql`
            DELETE FROM event_rollup_minutes
            WHERE project_id = ${projectId}::uuid
              AND minute >= ${from.toISOString()}::timestamptz
              AND minute <  ${to.toISOString()}::timestamptz
        `);

        await tx.execute(sql`
            WITH cells AS (
                -- One pass over events. Everything below re-aggregates this
                -- small result rather than reading the table again.
                SELECT
                    date_trunc('minute', timestamp)        AS minute,
                    level,
                    COALESCE(environment, '(unset)')       AS env,
                    COALESCE(source, '(unknown)')          AS src,
                    COUNT(*)::int                          AS n
                FROM events
                WHERE project_id = ${projectId}::uuid
                  AND timestamp >= ${from.toISOString()}::timestamptz
                  AND timestamp <  ${to.toISOString()}::timestamptz
                GROUP BY 1, 2, 3, 4
            ),
            levels AS (
                SELECT minute, jsonb_object_agg(level, n) AS by_level, SUM(n)::int AS total
                FROM (SELECT minute, level, SUM(n)::int AS n FROM cells GROUP BY 1, 2) l
                GROUP BY minute
            ),
            env_totals AS (
                SELECT minute, env, SUM(n)::int AS n FROM cells GROUP BY 1, 2
            ),
            env_capped AS (
                -- Keep the busiest environments and fold the tail into
                -- "(other)", so a project inventing an environment per deploy
                -- fattens a row instead of unbounding it.
                SELECT
                    minute,
                    CASE WHEN rn <= ${ENVIRONMENT_KEY_CAP} THEN env ELSE '(other)' END AS env,
                    SUM(n)::int AS n
                FROM (
                    SELECT minute, env, n,
                           ROW_NUMBER() OVER (PARTITION BY minute ORDER BY n DESC, env) AS rn
                    FROM env_totals
                ) ranked
                GROUP BY 1, 2
            ),
            envs AS (
                SELECT minute, jsonb_object_agg(env, n) AS by_env
                FROM env_capped
                GROUP BY minute
            ),
            src_totals AS (
                SELECT minute, src, SUM(n)::int AS n FROM cells GROUP BY 1, 2
            ),
            src_capped AS (
                -- Same cap as environments, for the same reason: source is
                -- client-supplied, so the tail folds into "(other)" rather than
                -- growing the object without bound.
                SELECT
                    minute,
                    CASE WHEN rn <= ${SOURCE_KEY_CAP} THEN src ELSE '(other)' END AS src,
                    SUM(n)::int AS n
                FROM (
                    SELECT minute, src, n,
                           ROW_NUMBER() OVER (PARTITION BY minute ORDER BY n DESC, src) AS rn
                    FROM src_totals
                ) ranked
                GROUP BY 1, 2
            ),
            sources AS (
                SELECT minute, jsonb_object_agg(src, n) AS by_source
                FROM src_capped
                GROUP BY minute
            )
            INSERT INTO event_rollup_minutes
                (project_id, minute, total, by_level, by_env, by_source, computed_at)
            SELECT ${projectId}::uuid, l.minute, l.total, l.by_level,
                   COALESCE(e.by_env, '{}'::jsonb),
                   COALESCE(s.by_source, '{}'::jsonb), now()
            FROM levels l
            LEFT JOIN envs e    ON e.minute = l.minute
            LEFT JOIN sources s ON s.minute = l.minute
        `);


        // ── template rollup ──────────────────────────────────────────────
        // Same window, same transaction, same delete-then-insert as above, so
        // the two rollups can never describe different slices of time.
        //
        // `template_hash IS NOT NULL` excludes events ingested before the
        // fingerprint shipped. They are not skipped rows to be recovered later
        // — nothing in SQL can derive a hash for them, because the normaliser
        // is TypeScript. What keeps that from becoming a silent undercount is
        // the coverage interval maintained below, not this filter.
        await tx.execute(sql`
            DELETE FROM event_template_rollup
            WHERE project_id = ${projectId}::uuid
              AND minute >= ${from.toISOString()}::timestamptz
              AND minute <  ${to.toISOString()}::timestamptz
        `);

        await tx.execute(sql`
            WITH cells AS (
                SELECT
                    date_trunc('minute', timestamp)  AS minute,
                    template_hash,
                    level,
                    COUNT(*)::int                    AS n,
                    MAX(timestamp)                   AS latest
                FROM events
                WHERE project_id = ${projectId}::uuid
                  AND timestamp >= ${from.toISOString()}::timestamptz
                  AND timestamp <  ${to.toISOString()}::timestamptz
                  AND template_hash IS NOT NULL
                GROUP BY 1, 2, 3
            )
            INSERT INTO event_template_rollup
                (project_id, minute, template_hash, count, by_level, latest_at)
            SELECT
                ${projectId}::uuid,
                minute,
                template_hash,
                SUM(n)::int,
                jsonb_object_agg(level, n),
                MAX(latest)
            FROM cells
            GROUP BY minute, template_hash
        `);
        await tx.execute(sql`
            UPDATE rollup_state
            SET refresh_from = ${to.toISOString()}::timestamptz - (${OVERLAP_MINUTES} || ' minutes')::interval,
                -- Only advance the completeness boundary; a catch-up run that
                -- rebuilt an old window must not claim the rollup is complete
                -- up to a point it has not reached.
                rolled_up_to = GREATEST(rolled_up_to, ${to.toISOString()}::timestamptz),
                -- The template rollup's coverage is an *interval*, not a prefix:
                -- events older than the fingerprint can never enter it, so a
                -- reader needs both ends to know whether its range is
                -- answerable here at all.
                templates_rolled_up_from = LEAST(
                    COALESCE(templates_rolled_up_from, ${from.toISOString()}::timestamptz),
                    ${from.toISOString()}::timestamptz
                ),
                templates_rolled_up_to = GREATEST(
                    templates_rolled_up_to,
                    ${to.toISOString()}::timestamptz
                )
            WHERE project_id = ${projectId}::uuid
        `);
    });

    return { projectId, from, to, hasMore: has_more };
}

/**
 * Drops rollup rows older than the events they summarise.
 *
 * Retention drops event partitions at 30 days; without this the rollup would
 * keep counting events that no longer exist, and the two would disagree
 * silently.
 */
export async function pruneRollup(): Promise<void> {
    await db.execute(sql`
        DELETE FROM event_rollup_minutes
        WHERE minute < date_trunc('minute', now()) - interval '30 days'
    `);

    // The template rollup ages out on the same boundary and for the same
    // reason: retention drops event partitions at 30 days, and a summary that
    // outlives the events it summarises makes the two disagree silently.
    await db.execute(sql`
        DELETE FROM event_template_rollup
        WHERE minute < date_trunc('minute', now()) - interval '30 days'
    `);

    // `message_templates` is deliberately **not** pruned here. It is a
    // vocabulary, not a measurement: one row per shape a project has ever sent,
    // measured at 18,080 a day on staging against millions of events. Dropping
    // a template whose last event just aged out would lose the display text for
    // a fingerprint that reappears the next time that shape is logged, and
    // rewriting it costs more than keeping it.
}

export interface RollupCycleResult {
    projects: number;
    caughtUp: number;
    stillBehind: number;
}

/**
 * One pass of the scheduled rebuild: catch up every project that is behind,
 * then drop rollup rows whose events have aged out.
 *
 * Lives here rather than inside the pg-boss handler so it can be tested
 * against a real database. The job file is then registration only — mocking
 * this module to test the handler would test the mock (PROJECT.md §11).
 */
export async function runRollupCycle(): Promise<RollupCycleResult> {
    const pending = await projectsNeedingRollup();
    let caughtUp = 0;
    let stillBehind = 0;

    for (const { projectId, refreshFrom } of pending) {
        const result = await rebuildRollupForProject(projectId, refreshFrom);
        if (result.hasMore) stillBehind++;
        else caughtUp++;
    }

    await pruneRollup();

    return { projects: pending.length, caughtUp, stillBehind };
}
