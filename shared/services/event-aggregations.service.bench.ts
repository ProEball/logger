import { bench, describe } from "vitest";
import { clickhouse } from "@/core/clickhouse/client";
import {
    environmentsInUse,
    eventBuckets,
    eventBucketsByLevel,
    eventsInLastMinute,
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
    resolveBusiestProject,
} from "@/bench/support/target";

/**
 * Both dashboards' read paths, one aggregation at a time.
 *
 * ## What this file is for now (rewritten in Phase 4)
 *
 * It used to be a rollup benchmark. Half its measurements were comparisons
 * against a summary table — "rollup only, range cut at the boundary" against
 * "rollup + raw tail", and every filtered twin, whose gap was described as
 * *what the rollup is worth, measured by taking it away*. None of those
 * comparisons exists any more: there is one table and one query per read.
 *
 * It was rewritten rather than deleted because **Phase 5 needs it**. The plan
 * requires the `p_minute` projection, the `events_by_template` MV and the
 * `events_by_correlation` MV each to be measured before and after they are
 * added (§12), and a projection is picked by the optimizer without the
 * application knowing — so the only way to see whether one was used is to time
 * the same call twice. Every benchmark below is currently a tier-2 raw scan,
 * which makes this run the "before".
 *
 * What it can and cannot show:
 * - It measures the queries, so it can prove or disprove a projection's worth.
 * - It cannot show what caching or streaming buy. Caching removes a query
 *   rather than speeding it up, and streaming changes when the first pixel
 *   appears, not how long the SQL takes.
 *
 * The floor benchmark matters more here than it did against Postgres: over an
 * SSH tunnel to a remote ClickHouse it dominates anything under ~100 ms, and
 * every number below should be read after subtracting it.
 */

const target = await resolveBenchTarget();
const range = benchRange(target);

/**
 * The environment the filtered benchmarks below select. See
 * `resolveBenchEnvironment` for why it is the busiest one and why its share is
 * reported.
 */
const environment = await resolveBenchEnvironment(target, range);
const envFilter = environment ? [environment.name] : undefined;

const projectId = await resolveBusiestProject(target, range);
if (!projectId) {
    throw new Error(
        "no project has events in the benchmark range — seed a corpus first (npm run bench:seed)",
    );
}

// Printed once per run: a timing without the shape of the data behind it
// cannot be compared with anything.
console.log(
    `\n[bench] ${describeTarget(target, range)}\n` +
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

/** One round trip, no work. Subtract this from every other number. */
async function roundTrip(): Promise<void> {
    const result = await clickhouse.query({ query: "SELECT 1 AS one", format: "JSONEachRow" });
    await result.json();
}

describe("organization overview", () => {
    bench("round-trip floor (SELECT 1)", async () => {
        await roundTrip();
    });

    // Split on 2026-08-20: these were one function, so this benchmark reported
    // the max of the two rather than either. The gap was the whole point then —
    // 954 ms of message aggregation holding up ~30 ms of counts. Both group by
    // `template_hash` now, so watch whether the gap survived the move.
    bench("topMessagePerProject — one GROUP BY, LIMIT 1 BY project", async () => {
        await topMessagePerProject(ids, range);
    });

    bench("projectStats — counts and environment pills in parallel", async () => {
        await projectStats(ids, range);
    });

    bench("topMessages (errors) — group by template_hash", async () => {
        await topMessages(ids, range, { levels: TOP_ERRORS, limit: 5 });
    });

    bench("levelBreakdown", async () => {
        await levelBreakdown(ids, range);
    });

    bench("environmentsInUse — 30-day SELECT DISTINCT (was a registry table)", async () => {
        // The number to watch. Under Postgres this was a registry maintained at
        // ingest precisely because scanning 30 days of events cost 39.3 ms and
        // 13.4% of the page's database time. Phase 4 went back to the scan on
        // the argument that a LowCardinality column makes it cheap; this
        // benchmark is where that argument is either confirmed or paid for.
        await environmentsInUse(ids);
    });

    bench("eventBuckets — one scan, no union", async () => {
        await eventBuckets(ids, range, 3600);
    });

    /**
     * All of it, the way the page actually does it. Not the sum of the parts:
     * the queries run concurrently and contend for the same client.
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
 * **Why these still exist.** Under Postgres the gap between each pair measured
 * what the rollup was worth, because four of the six calls abandoned it under a
 * filter. There is nothing to abandon now, so the gap measures something
 * simpler and still worth knowing: what an extra predicate costs on a
 * `LowCardinality` column that is **not** in the sort key. If it is close to
 * free the filter bar is free; if it is not, `environment` is a candidate for
 * the tier-1 projection's key, which is the decision §6.2 has to make.
 */
describe("organization overview — one environment selected", () => {
    bench("projectStats — filtered", async () => {
        await projectStats(ids, range, envFilter);
    });

    bench("topMessagePerProject — filtered", async () => {
        await topMessagePerProject(ids, range, envFilter);
    });

    bench("topMessages (errors) — filtered", async () => {
        await topMessages(ids, range, { levels: TOP_ERRORS, environments: envFilter, limit: 5 });
    });

    bench("levelBreakdown — filtered", async () => {
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
    bench("round-trip floor (SELECT 1)", async () => {
        await roundTrip();
    });

    bench("hasAnyEvents — serialised gate, runs before the fan-out", async () => {
        await hasAnyEvents([projectId]);
    });

    bench("eventBucketsByLevel — five countIf over one scan", async () => {
        await eventBucketsByLevel([projectId], resolveRange(timeRange), 60);
    });

    bench("levelBreakdown", async () => {
        await levelBreakdown([projectId], resolveRange(timeRange));
    });

    bench("topMessages — group by template_hash", async () => {
        await topMessages([projectId], resolveRange(timeRange));
    });

    bench("topSources", async () => {
        await topSources([projectId], resolveRange(timeRange));
    });

    bench("recentErrors — returns whole rows", async () => {
        await recentErrors([projectId], resolveRange(timeRange));
    });

    bench("eventsInLastMinute — the live rate in the top bar", async () => {
        // Trailing 60 seconds, so against a static corpus it matches nothing.
        // Benchmarked anyway: it runs on every project page load and its cost
        // is the granule lookup, not the rows it returns.
        await eventsInLastMinute([projectId]);
    });
});

describe("project dashboard — the page", () => {
    /**
     * The fan-out as the route issues it: five aggregations in parallel.
     * `listAlertRules` is left out — it reads `alert_rules`, not events, and
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
