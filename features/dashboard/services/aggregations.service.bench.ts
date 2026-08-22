import { bench, describe } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/core/db/client";
import {
    eventsPerMinute,
    hasAnyEvents,
    levelBreakdown,
    recentErrors,
    topMessages,
    topSources,
} from "@/features/dashboard/services/aggregations.service";
import type { TimeRange } from "@/shared/utils/event-filters.schema";
import { benchRange, describeTarget, resolveBenchTarget } from "@/bench/support/target";

/**
 * The project dashboard's read path, one aggregation at a time.
 *
 * **Written 2026-08-21 because this page had never been measured.** Every share
 * in `widgets.md` came from a `pg_stat_statements` run that covered `/[org]` and
 * nothing else, so the plan for this page rested on analogy with the org
 * overview — and analogy is what §16.1's discussion gate exists to prevent.
 *
 * The first run settled it, and against expectations twice: `topMessages` is
 * 170 ms of a 170 ms fan-out, and the serialised `hasAnyEvents` gate that had
 * been called out as a likely cause of the page's latency is **1.2 ms** of it.
 * Results and what they changed: `PLAN.md` §16.2, baseline in
 * `bench/baselines/2026-08-21-local-500k-dashboard.json`.
 *
 * What is different here, and why the overview's answers may not transfer:
 *
 * - **Nothing on this page read the rollup when these numbers were taken.** All
 *   six aggregations went to raw `events`, so unlike the overview there was no
 *   rollup-backed half to be held up by a slow one — the whole page was the slow
 *   half. §16.2 item 5 moved `eventsPerMinute`, `levelBreakdown` and
 *   `hasAnyEvents` onto it later the same day, so re-running this benchmark now
 *   measures a different page than the baseline it is compared against.
 * - **`hasAnyEvents` is awaited before everything else** (`app/[org]/[project]/page.tsx`),
 *   not inside the `Promise.all`. It gates the entire route, so its cost is
 *   *serialised* in front of the fan-out rather than hidden inside it. The last
 *   two benchmarks below size that specifically.
 * - **The route awaited one `Promise.all` when these numbers were taken**, so
 *   time-to-first-pixel was the whole fan-out rather than the fastest widget.
 *   §16.2 item 4 replaced that with six unawaited promises and a `Suspense`
 *   boundary per widget the same day. The per-query benchmarks below are
 *   unaffected by that — they measure queries, not page structure — but the two
 *   page-level ones no longer describe how the route behaves.
 * - **Two of six can never come off raw events** — `topMessages` by cardinality,
 *   `recentErrors` because it returns whole rows — and a third, `topSources`,
 *   would need a `by_source` column the rollup does not have.
 *
 * The same caveats as the overview benchmark apply: these are wall-clock
 * client-side measurements including one round trip each, so read everything net
 * of the floor, and a change claiming less than ~10% is inside the noise.
 *
 * One more, learned the hard way from the first run: **`benchRange` is 24 hours**
 * of whatever corpus this is pointed at. Every raw-`events` query here scans in
 * proportion to that window, so these numbers say nothing about a 30-day range
 * over 30 days of data — which is the case that decides whether the rollup is
 * worth it. Reading "the rollup saves nothing" out of this file would be reading
 * a window, not a conclusion.
 */

const target = await resolveBenchTarget();
const range = benchRange(target);

/**
 * One project, not the whole organization — this page is per-project. The
 * busiest one is chosen so the numbers describe the case that hurts.
 */
const [busiest] = await db.execute<{ project_id: string; n: string }>(sql`
    SELECT project_id::text, COUNT(*)::text AS n
    FROM events
    WHERE project_id = ANY(ARRAY[${sql.join(
        target.projectIds.map((id) => sql`${id}::uuid`),
        sql`, `,
    )}])
      AND timestamp >= ${range.from.toISOString()}::timestamptz
      AND timestamp <  ${range.to.toISOString()}::timestamptz
    GROUP BY project_id
    ORDER BY COUNT(*) DESC
    LIMIT 1
`);

if (!busiest) {
    throw new Error(
        "no project has events in the benchmark range — seed a corpus first (npm run bench:seed)",
    );
}

const projectId = busiest.project_id;

/**
 * The aggregations take a `TimeRange` and resolve it themselves, so the
 * benchmark hands them a `custom` range rather than a preset. A preset would
 * re-anchor on `now()` inside each call, which against a corpus that stopped
 * being written to measures an empty window and reports it as a fast query.
 */
const timeRange: TimeRange = {
    type: "custom",
    from: range.from.toISOString(),
    to: range.to.toISOString(),
};

console.log(
    `\n[bench] ${describeTarget(target, range)}\n  dashboard project ${projectId} · ` +
        `${Number(busiest.n).toLocaleString()} events in range\n`,
);

describe("project dashboard — one aggregation at a time", () => {
    /**
     * The floor every other number is read against: one round trip, no work.
     */
    bench("round-trip floor (SELECT 1)", async () => {
        await db.execute(sql`SELECT 1`);
    });

    bench("hasAnyEvents — serialised gate, runs before the fan-out", async () => {
        await hasAnyEvents(projectId);
    });

    bench("eventsPerMinute — bucket × level", async () => {
        await eventsPerMinute(projectId, timeRange);
    });

    bench("levelBreakdown", async () => {
        await levelBreakdown(projectId, timeRange);
    });

    bench("topMessages — message-keyed, never servable from the rollup", async () => {
        await topMessages(projectId, timeRange);
    });

    bench("topSources", async () => {
        await topSources(projectId, timeRange);
    });

    bench("recentErrors — returns whole rows", async () => {
        await recentErrors(projectId, timeRange);
    });
});

describe("project dashboard — the page", () => {
    /**
     * The fan-out as the route issues it: five aggregations in parallel.
     * `listAlertRules` is left out — it reads `alert_rules`, not `events`, and
     * including it would make the number depend on how many rules happen to
     * exist in whatever database this is pointed at.
     */
    bench("fan-out only (5 aggregations in parallel)", async () => {
        await Promise.all([
            eventsPerMinute(projectId, timeRange),
            levelBreakdown(projectId, timeRange),
            topMessages(projectId, timeRange),
            recentErrors(projectId, timeRange),
            topSources(projectId, timeRange),
        ]);
    });

    /**
     * The same work the way the route actually does it — `hasAnyEvents` awaited
     * first, then the fan-out. The gap between this and the benchmark above is
     * the cost of the serialisation, and it is the one number that says whether
     * moving the gate is worth doing.
     */
    bench("what the route does (gate, then fan-out)", async () => {
        await hasAnyEvents(projectId);
        await Promise.all([
            eventsPerMinute(projectId, timeRange),
            levelBreakdown(projectId, timeRange),
            topMessages(projectId, timeRange),
            recentErrors(projectId, timeRange),
            topSources(projectId, timeRange),
        ]);
    });
});
