import { bench, describe } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/core/db/client";
import {
    environmentsInUse,
    eventBuckets,
    eventBucketsByLevel,
    hasAnyEvents,
    levelBreakdown,
    projectStats,
    recentErrors,
    topMessagePerProject,
    topMessages,
    topSources,
} from "@/shared/services/event-aggregations.service";
import { resolveRange } from "@/shared/utils/dashboard-filters";
import type { TimeRange } from "@/shared/utils/event-filters.schema";
import {
    benchRange,
    describeTarget,
    resolveBenchEnvironment,
    resolveBenchTarget,
} from "@/bench/support/target";
import { markRollupDirty, rebuildRollupForProject } from "@/features/ingest/services/event-rollup.service";

/**
 * The organization overview's read path, one aggregation at a time.
 *
 * This is the page measured at 1.4–1.6 s on 540k events during the staging run
 * (`PROGRESS.md`, read-path audit). One page load issues **10 SQL statements**
 * across 8 distinct shapes: the six service calls benched below, of which
 * `projectStats` is a rollup boundary plus two queries in parallel, and
 * `levelBreakdown` and `eventBuckets` are a boundary plus one each.
 * Re-counted with `pg_stat_statements` on 2026-08-20 after the per-project top
 * message was split onto its own call — the split changed neither number.
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

/**
 * The environment the filtered benchmarks below select. See
 * `resolveBenchEnvironment` for why it is the busiest one and why its share is
 * reported.
 */
const environment = await resolveBenchEnvironment(target, range);
const envFilter = environment ? [environment.name] : undefined;

// Printed once per run: a timing without the shape of the data behind it
// cannot be compared with anything.
console.log(
    `\n[bench] ${describeTarget(target, range)}\n  rollup ${Number(rollupSize.rows).toLocaleString()} minute rows, ` +
        `complete to ${rollupSize.boundary ? new Date(rollupSize.boundary).toISOString() : "nothing"}\n` +
        `  env filter: ${
            environment
                ? `"${environment.name}" — ${environment.events.toLocaleString()} events, ` +
                  `${(environment.share * 100).toFixed(1)}% of the range`
                : "none in this corpus; filtered benchmarks measure an empty filter"
        }\n`,
);

const ids = target.projectIds;

/** What the overview's top-errors widget ranks on. */
const TOP_ERRORS = ["error", "fatal"] as const;

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

    // Split on 2026-08-20: these were one function, so this benchmark reported
    // the max of the two rather than either. Measured separately, the gap is the
    // whole point — the stats are rollup-backed milliseconds and the message
    // aggregation is hundreds.
    bench("topMessagePerProject — the message aggregation alone", async () => {
        await topMessagePerProject(ids, range);
    });

    bench("projectStats — 2 queries in parallel, rollup-backed", async () => {
        await projectStats(ids, range);
    });

    bench("topMessages (errors) — group by SUBSTRING(message, 1, 200)", async () => {
        await topMessages(ids, range, { levels: TOP_ERRORS, limit: 5 });
    });

    bench("levelBreakdown", async () => {
        await levelBreakdown(ids, range);
    });

    bench("environmentsInUse — registry lookup (was a 30-day scan)", async () => {
        // Reads `project_environments`, a registry maintained at ingest.
        // Until 2026-08-20 it scanned 30 days of `events` on every page load
        // to build a list of a handful of values: 39.3 ms → 0.67 ms here, and
        // 13.4% of the page's database time → effectively nothing.
        await environmentsInUse(ids);
    });

    bench("eventBuckets — rollup + raw tail (what the page does)", async () => {
        await eventBuckets(ids, range, 3600);
    });

    bench("eventBuckets — rollup only, range cut at the boundary", async () => {
        await eventBuckets(ids, rolledOnlyRange, 3600);
    });

    /**
     * All of it, the way the page actually does it. Not the sum of the parts:
     * the queries run concurrently and contend for the same connection pool,
     * which has ten slots for the ten statements one page load issues. That
     * margin used to be comfortable and is now exactly none — worth watching
     * before adding a seventh call.
     */
    bench("whole page fan-out (what /[org] awaits)", async () => {
        await Promise.all([
            projectStats(ids, range),
            topMessagePerProject(ids, range),
            topMessages(ids, range, { levels: TOP_ERRORS, limit: 5 }),
            levelBreakdown(ids, range),
            environmentsInUse(ids),
            eventBuckets(ids, range, 3600),
        ]);
    });
});

/**
 * The same page with one environment pill selected.
 *
 * **Why these exist (2026-08-25).** Every benchmark above runs unfiltered, which
 * is the path the rollup work of 2026-08-20…24 optimised — and it is not the
 * path a user takes the moment they click an environment. Four of the six calls
 * abandon the rollup under a filter: `by_level` and `by_env` are marginals, so
 * neither can answer "errors in production", and `event_template_rollup` stores
 * no environment at all. Those four fall back to raw `events`, which is the
 * code as it stood before any of the rollup work landed.
 *
 * So the gap between each pair below is not "what the filter costs". It is
 * **what the rollup is worth**, measured by taking it away — and it is the number
 * the decision to put `environment` into both rollup keys has to justify itself
 * against. Benchmarking only the unfiltered path would have reported the work as
 * finished while half the page's real traffic never touched it.
 *
 * `eventBuckets` gained a filtered twin on 2026-08-25. Until then it had none,
 * and its absence was itself the measurement: the volume chart took no
 * environment argument at all, so there was nothing to compare because there was
 * nothing to call. That was the last asymmetry `widgets.md` recorded, and
 * merging the two bucket queries into one closed it.
 */
describe("organization overview — one environment selected", () => {
    bench("projectStats — filtered, now rollup-backed", async () => {
        await projectStats(ids, range, envFilter);
    });

    bench("topMessagePerProject — filtered, no template rollup", async () => {
        await topMessagePerProject(ids, range, envFilter);
    });

    bench("topMessages (errors) — filtered, no template rollup", async () => {
        await topMessages(ids, range, { levels: TOP_ERRORS, environments: envFilter, limit: 5 });
    });

    bench("levelBreakdown — filtered, now rollup-backed", async () => {
        await levelBreakdown(ids, range, envFilter);
    });

    bench("whole page fan-out — filtered", async () => {
        await Promise.all([
            projectStats(ids, range, envFilter),
            topMessagePerProject(ids, range, envFilter),
            topMessages(ids, range, { levels: TOP_ERRORS, environments: envFilter, limit: 5 }),
            levelBreakdown(ids, range, envFilter),
            environmentsInUse(ids),
            // Unfiltered on purpose: this is what the page actually issues.
            eventBuckets(ids, range, 3600),
        ]);
    });
});

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


describe("project dashboard — one aggregation at a time", () => {
    /**
     * The floor every other number is read against: one round trip, no work.
     */
    bench("round-trip floor (SELECT 1)", async () => {
        await db.execute(sql`SELECT 1`);
    });

    bench("hasAnyEvents — serialised gate, runs before the fan-out", async () => {
        await hasAnyEvents([projectId]);
    });

    bench("eventBucketsByLevel — the jsonb path", async () => {
        await eventBucketsByLevel([projectId], resolveRange(timeRange), 60);
    });

    bench("levelBreakdown", async () => {
        await levelBreakdown([projectId], resolveRange(timeRange));
    });

    bench("topMessages — message-keyed, never servable from the rollup", async () => {
        await topMessages([projectId], resolveRange(timeRange));
    });

    bench("topSources", async () => {
        await topSources([projectId], resolveRange(timeRange));
    });

    bench("recentErrors — returns whole rows", async () => {
        await recentErrors([projectId], resolveRange(timeRange));
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
            eventBuckets([projectId], resolveRange(timeRange), 60),
            levelBreakdown([projectId], resolveRange(timeRange)),
            topMessages([projectId], resolveRange(timeRange)),
            recentErrors([projectId], resolveRange(timeRange)),
            topSources([projectId], resolveRange(timeRange)),
        ]);
    });

    /**
     * The same work the way the route actually does it — `hasAnyEvents` awaited
     * first, then the fan-out. The gap between this and the benchmark above is
     * the cost of the serialisation, and it is the one number that says whether
     * moving the gate is worth doing.
     */
    bench("what the route does (gate, then fan-out)", async () => {
        await hasAnyEvents([projectId]);
        await Promise.all([
            eventBuckets([projectId], resolveRange(timeRange), 60),
            levelBreakdown([projectId], resolveRange(timeRange)),
            topMessages([projectId], resolveRange(timeRange)),
            recentErrors([projectId], resolveRange(timeRange)),
            topSources([projectId], resolveRange(timeRange)),
        ]);
    });
});
