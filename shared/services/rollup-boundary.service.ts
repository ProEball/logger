import { sql } from "drizzle-orm";
import { db } from "@/core/db/client";

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
        missing: number;
        present: number;
    }>(sql`
        SELECT MIN(rolled_up_to)                                   AS boundary,
               COUNT(*) FILTER (WHERE rolled_up_to IS NULL)::int    AS missing,
               COUNT(*)::int                                       AS present
        FROM rollup_state
        WHERE project_id = ANY(ARRAY[${sql.join(
            projectIds.map((id) => sql`${id}::uuid`),
            sql`, `,
        )}])
    `);

    const row = rows[0];
    if (!row) return null;

    // A project with a row but a NULL watermark has never been rolled up.
    if (row.missing > 0) return null;

    // A project with **no row at all** is the subtle one, and the reason this
    // check exists. `MIN` and the NULL filter both ignore absent rows, so a
    // project missing from `rollup_state` would inherit the other projects'
    // boundary — and then contribute zero rollup rows below it, because nothing
    // ever summarised it. The result is an undercount that looks like a quiet
    // project.
    //
    // It cannot happen today: `markRollupDirty` writes a row on every ingest
    // and migration 0008 seeded one per existing project. That is exactly the
    // problem — the correctness holds by accident of two other mechanisms
    // rather than by anything here, and the guard costs one comparison.
    if (row.present !== projectIds.length) return null;

    if (row.boundary == null) return null;
    return new Date(row.boundary);
}
