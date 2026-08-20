import { bench, describe } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/core/db/client";
import {
    getOrgEnvironments,
    getOrgEventBuckets,
    getOrgLevelBreakdown,
    getOrgTopErrors,
    getProjectSummaries,
} from "@/features/overview/services/overview.service";
import { benchRange, describeTarget, resolveBenchTarget } from "@/bench/support/target";
import { markRollupDirty, rebuildRollupForProject } from "@/features/ingest/services/event-rollup.service";

/**
 * The organization overview's read path, one aggregation at a time.
 *
 * This is the page measured at 1.4–1.6 s on 540k events during the staging run
 * (`PROGRESS.md`, read-path audit). One page load issues **eight** queries: the
 * five below, with `getProjectSummaries` itself being three in parallel.
 *
 * What this file can and cannot show:
 * - It measures the queries, so it can prove or disprove Stage E.
 * - It cannot show Stage D. Caching removes a query rather than speeding it up,
 *   and streaming changes when the first pixel appears, not how long the SQL
 *   takes. Those need the page-level benchmark.
 */

const target = await resolveBenchTarget();
const range = benchRange(target);

/**
 * Build the rollup before measuring anything.
 *
 * Without this the benchmark would measure a path production never takes:
 * `rolled_up_to` would be NULL for every project, every read would fall back
 * entirely to `events`, and the numbers would describe the code as it was
 * before the rollup existed. The same trap nearly swallowed the environments
 * registry — a benchmark against an empty table reports a speedup that is only
 * the emptiness.
 *
 * Uses the real service, so what is measured is what the job builds.
 */
for (const projectId of target.projectIds) {
    if (!target.oldest) break;
    await markRollupDirty(projectId, target.oldest);
    for (let i = 0; i < 60; i++) {
        const [state] = await db.execute<{ refresh_from: Date }>(sql`
            SELECT refresh_from FROM rollup_state WHERE project_id = ${projectId}::uuid
        `);
        if (!state) break;
        const result = await rebuildRollupForProject(projectId, new Date(state.refresh_from));
        if (!result.hasMore) break;
    }
}

/**
 * Push the completeness boundary back two minutes.
 *
 * Without this the benchmark lies about the tail. The build above finishes
 * *after* the newest event in the corpus, so `rolled_up_to` lands past it and
 * the tail range is empty — the union would measure as free because there was
 * nothing in it to union. Production never looks like that: the job sets the
 * boundary to the start of the current minute, so the tail always holds
 * whatever has arrived since.
 *
 * Rollup rows above the boundary stay in the table and are simply ignored by
 * the read (`minute < LEAST(to, boundary)`), which is exactly what happens
 * between two job runs.
 *
 * Two minutes by default, matching `OVERLAP_MINUTES`. `BENCH_TAIL_MINUTES`
 * widens it, which is how the tail's cost was shown to scale with the events
 * in it rather than with the range being charted.
 */
const TAIL_MINUTES = Number(process.env.BENCH_TAIL_MINUTES ?? 2);

await db.execute(
    sql`UPDATE rollup_state SET rolled_up_to = rolled_up_to - (${TAIL_MINUTES} || ' minutes')::interval`,
);

const [rollupSize] = await db.execute<{ rows: string; boundary: Date | null }>(sql`
    SELECT
        (SELECT COUNT(*)::text FROM event_rollup_minutes)  AS rows,
        (SELECT MIN(rolled_up_to) FROM rollup_state)       AS boundary
`);

// Printed once per run: a timing without the shape of the data behind it
// cannot be compared with anything.
console.log(
    `\n[bench] ${describeTarget(target, range)}\n  rollup ${Number(rollupSize.rows).toLocaleString()} minute rows, ` +
        `complete to ${rollupSize.boundary ? new Date(rollupSize.boundary).toISOString() : "nothing"}\n`,
);

const ids = target.projectIds;

/**
 * The same range, cut off at the rollup boundary — so it reads the summary and
 * nothing else. Subtracting this from the full-range benchmark isolates what
 * the raw tail costs, which is the question the union design has to answer:
 * the tail is what keeps the newest minute visible, and if it were expensive
 * the whole approach would be wrong.
 */
const rolledOnlyRange = rollupSize.boundary
    ? { from: range.from, to: new Date(rollupSize.boundary) }
    : range;

describe("organization overview", () => {
    /**
     * The cost of asking at all — one round trip, no work. Subtract this from
     * every other number. Over an SSH tunnel to the staging host it is the
     * dominant term for anything under ~100 ms.
     */
    bench("round-trip floor (SELECT 1)", async () => {
        await db.execute(sql`SELECT 1`);
    });

    bench("getProjectSummaries — 3 queries in parallel", async () => {
        await getProjectSummaries(ids, range);
    });

    bench("getOrgTopErrors — group by SUBSTRING(message, 1, 200)", async () => {
        await getOrgTopErrors(ids, range);
    });

    bench("getOrgLevelBreakdown", async () => {
        await getOrgLevelBreakdown(ids, range);
    });

    bench("getOrgEnvironments — registry lookup (was a 30-day scan)", async () => {
        // Reads `project_environments`, a registry maintained at ingest.
        // Until 2026-08-20 it scanned 30 days of `events` on every page load
        // to build a list of a handful of values: 39.3 ms → 0.67 ms here, and
        // 13.4% of the page's database time → effectively nothing.
        await getOrgEnvironments(ids);
    });

    bench("getOrgEventBuckets — rollup + raw tail (what the page does)", async () => {
        await getOrgEventBuckets(ids, range, 3600);
    });

    bench("getOrgEventBuckets — rollup only, range cut at the boundary", async () => {
        await getOrgEventBuckets(ids, rolledOnlyRange, 3600);
    });

    /**
     * All of it, the way the page actually does it. Not the sum of the parts:
     * the queries run concurrently and contend for the same connection pool,
     * which has ten slots for the eight queries one page load issues.
     */
    bench("whole page fan-out (what /[org] awaits)", async () => {
        await Promise.all([
            getProjectSummaries(ids, range),
            getOrgTopErrors(ids, range),
            getOrgLevelBreakdown(ids, range),
            getOrgEnvironments(ids),
            getOrgEventBuckets(ids, range, 3600),
        ]);
    });
});
