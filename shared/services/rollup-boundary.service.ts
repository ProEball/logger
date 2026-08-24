import { sql } from "drizzle-orm";
import { db } from "@/core/db/client";

/** `id, id, id` as cast uuid literals, for an `ARRAY[…]` constructor. */
function uuidArray(projectIds: string[]) {
    return sql.join(
        projectIds.map((id) => sql`${id}::uuid`),
        sql`, `,
    );
}

/**
 * The instant up to which the event rollup is complete for **every** requested
 * project, or `null` when it is not complete for all of them.
 *
 * Every rollup-backed read is `rollup rows below the boundary UNION raw events
 * above it`. Get the boundary wrong in the optimistic direction and the query
 * reads summary rows that were never written — silently undercounting, with no
 * error anywhere. So this returns `null` — meaning "read everything from raw
 * `events`" — for any doubt at all.
 *
 * Lives in `shared/services/` because two features need it: the org overview
 * (`features/overview`) and the project dashboard (`features/dashboard`). The
 * alternative was a second copy, and this repository spent 2026-08-20 and -21
 * fixing three separate cases of a value restated in a second place and then
 * drifting — a Zod enum, a preset list, an auto-refresh option list. §2.1 says
 * what to do here and this is it.
 *
 * (`shared/services/` is defined by the FDD convention in `PROJECT.md` §2.1 and
 * had been empty since its only occupant, a dead logger module, was removed on
 * 2026-08-13.)
 */
export async function rollupBoundary(projectIds: string[]): Promise<Date | null> {
    if (projectIds.length === 0) return null;

    const rows = await db.execute<{
        boundary: Date | null;
        blocking: number;
        usable: number;
    }>(sql`
        SELECT MIN(j.rolled_up_to)                                       AS boundary,
               COUNT(*) FILTER (WHERE j.rolled_up_to IS NULL
                                  AND j.has_events)::int                 AS blocking,
               COUNT(*) FILTER (WHERE j.rolled_up_to IS NOT NULL)::int    AS usable
        FROM (
            SELECT s.project_id,
                   rs.rolled_up_to,
                   -- Served by events_project_timestamp_idx. Proving absence
                   -- probes each daily partition, which is what makes this a
                   -- sub-millisecond question rather than a free one.
                   EXISTS (
                       SELECT 1 FROM events e WHERE e.project_id = s.project_id
                   ) AS has_events
            FROM (SELECT unnest(ARRAY[${uuidArray(projectIds)}]) AS project_id) s
            LEFT JOIN rollup_state rs ON rs.project_id = s.project_id
        ) j
    `);

    const row = rows[0];
    if (!row) return null;

    // The hazard, in one number: a project that **has events** and no usable
    // watermark — either no `rollup_state` row at all, or a row that has never
    // been rolled up. `MIN` ignores both cases, so such a project would inherit
    // the other projects' boundary and then contribute zero summary rows below
    // it. The result is an undercount that looks like a quiet project.
    //
    // An event-free project is deliberately **not** counted here, and that is
    // the whole of the 2026-08-24 fix. It contributes nothing to the rollup and
    // nothing to raw `events`, so it cannot undercount anything — while the old
    // guard ("every requested project must have a row, with a watermark")
    // failed it twice over: `markRollupDirty` only writes on ingest, so a
    // project that never received an event has no row, and migration 0008
    // seeded event-free projects with a row whose watermark stays NULL forever.
    // Either shape sent an entire organization's overview to raw `events`.
    //
    // The previous version of this comment noted that its own correctness held
    // "by accident of two other mechanisms rather than by anything here". It
    // did, and it stopped holding the first time somebody created a project.
    if (row.blocking > 0) return null;

    // Nothing anywhere in scope has been rolled up — every project is empty, or
    // the job has not run yet. Reading raw `events` is both correct and cheap.
    if (row.usable === 0) return null;

    if (row.boundary == null) return null;
    return new Date(row.boundary);
}

/**
 * The interval the **template** rollup actually covers for one project, or
 * `null` when it covers nothing usable.
 *
 * An interval rather than a boundary, and that is the whole difference from
 * `rollupBoundary` above. The level rollup can summarise any event, so its
 * coverage is a prefix and one watermark describes it. The template rollup can
 * only summarise events carrying a `template_hash`, so it has a floor as well
 * as a ceiling.
 *
 * **`from` is `null` when nothing is left uncovered**, and that case is the
 * common one rather than an edge. Until 2026-08-24 the floor was
 * `templates_rolled_up_from` and the caller compared it against the start of
 * the requested range — so a 7-day read on a corpus five days old took the
 * raw-text fallback, because the window began before the first event ever
 * recorded. There were no events in that gap. The rollup would have answered
 * completely, and the check was being conservative about nothing; on staging it
 * cost 8.6 s a read for no reason at all.
 *
 * What actually forces a fallback is an event with **no fingerprint** below the
 * range, and that is what is asked here — via a partial index that is empty
 * whenever ingest has been setting the hash, so the question is free.
 */
export interface TemplateCoverage {
    /**
     * Oldest instant the rollup can answer for, or `null` when every event that
     * exists carries a fingerprint and there is nothing below it to miss.
     */
    from: Date | null;
    to: Date;
}

export async function templateCoverage(projectId: string): Promise<TemplateCoverage | null> {
    const rows = await db.execute<{
        from_ts: Date | null;
        to_ts: Date | null;
        oldest_unfingerprinted: Date | null;
    }>(sql`
        SELECT
            rs.templates_rolled_up_from AS from_ts,
            rs.templates_rolled_up_to   AS to_ts,
            -- Served by events_unfingerprinted_idx, which is empty unless a
            -- backfill is outstanding.
            (
                SELECT MIN(e.timestamp)
                FROM events e
                WHERE e.project_id = ${projectId}::uuid
                  AND e.template_hash IS NULL
            ) AS oldest_unfingerprinted
        FROM rollup_state rs
        WHERE rs.project_id = ${projectId}::uuid
    `);

    const row = rows[0];
    if (!row || row.from_ts == null || row.to_ts == null) return null;

    const rolledFrom = new Date(row.from_ts);
    const to = new Date(row.to_ts);

    // An empty or inverted interval covers nothing. Cheap, and it keeps a
    // half-written state from being read as "everything is covered".
    if (!(rolledFrom < to)) return null;

    if (row.oldest_unfingerprinted == null) {
        // Every event has a fingerprint, so nothing sits below the rollup that
        // it could miss. Any range is answerable.
        return { from: null, to };
    }

    // Something is unfingerprinted. The rollup is trustworthy only above it —
    // and above its own floor, whichever is later.
    const unfingerprinted = new Date(row.oldest_unfingerprinted);
    return { from: unfingerprinted > rolledFrom ? unfingerprinted : rolledFrom, to };
}

/**
 * The template coverage common to **every** listed project, or `null` when any
 * of them cannot be answered from the rollup.
 *
 * The org overview reads across a list of projects in one query, so it needs
 * one interval that holds for all of them: the **latest** floor and the
 * **earliest** ceiling. A project whose rollup is behind therefore drags the
 * whole page to the fallback rather than contributing a short answer — which is
 * the conservative direction, and the only one that cannot undercount.
 *
 * `from` is `null` only when no project has an unfingerprinted event, meaning
 * nothing anywhere sits below the rollup for a range to miss.
 */
export async function templateCoverageForProjects(
    projectIds: string[],
): Promise<TemplateCoverage | null> {
    if (projectIds.length === 0) return null;

    const rows = await db.execute<{
        from_ts: Date | null;
        to_ts: Date | null;
        blocking: number;
        usable: number;
        oldest_unfingerprinted: Date | null;
    }>(sql`
        SELECT
            MAX(j.templates_rolled_up_from)                                   AS from_ts,
            MIN(j.templates_rolled_up_to)                                     AS to_ts,
            COUNT(*) FILTER (WHERE (j.templates_rolled_up_to IS NULL
                                 OR j.templates_rolled_up_from IS NULL)
                               AND j.has_events)::int                         AS blocking,
            COUNT(*) FILTER (WHERE j.templates_rolled_up_to IS NOT NULL
                               AND j.templates_rolled_up_from IS NOT NULL)::int AS usable,
            (
                SELECT MIN(e.timestamp)
                FROM events e
                WHERE e.project_id = ANY(ARRAY[${uuidArray(projectIds)}])
                  AND e.template_hash IS NULL
            )                                                                 AS oldest_unfingerprinted
        FROM (
            SELECT s.project_id,
                   rs.templates_rolled_up_from,
                   rs.templates_rolled_up_to,
                   EXISTS (
                       SELECT 1 FROM events e WHERE e.project_id = s.project_id
                   ) AS has_events
            FROM (SELECT unnest(ARRAY[${uuidArray(projectIds)}]) AS project_id) s
            LEFT JOIN rollup_state rs ON rs.project_id = s.project_id
        ) j
    `);

    const row = rows[0];
    if (!row) return null;

    // Same shape as `rollupBoundary` above, and the same fix: only a project
    // that **has events** without a usable interval can undercount.
    //
    // Both ends are checked, not just the ceiling. `MAX` ignores NULLs exactly
    // as `MIN` does, so a project with a ceiling but no floor would have handed
    // this function some *other* project's floor — the identical inheritance
    // bug, one column over, and the version before 2026-08-24 filtered on
    // `templates_rolled_up_to` alone. It was unreachable only because the job
    // writes both columns in one statement; that is a second mechanism holding
    // this one correct, which is the thing this file has now been bitten by.
    if (row.blocking > 0) return null;
    if (row.usable === 0) return null;
    if (row.to_ts == null || row.from_ts == null) return null;

    const to = new Date(row.to_ts);
    const rolledFrom = new Date(row.from_ts);
    if (!(rolledFrom < to)) return null;

    if (row.oldest_unfingerprinted == null) return { from: null, to };

    const unfingerprinted = new Date(row.oldest_unfingerprinted);
    return { from: unfingerprinted > rolledFrom ? unfingerprinted : rolledFrom, to };
}
