import { beforeAll, describe, expect, it } from "vitest";
import {
    eventsPerMinute,
    hasAnyEvents,
    levelBreakdown,
    recentErrors,
    topMessages,
    topSources,
} from "@/features/dashboard/services/aggregations.service";
import type { TimeRange } from "@/features/events/utils/event-filters.types";
import { ALPHA, DASH, QUIET, canonicalRange } from "@/itest/support/fixture";
import { readAnchor } from "@/itest/support/read-anchor";

/**
 * Integration tests for the project dashboard's raw-SQL aggregations.
 *
 * **This service had no tests at all until 2026-08-21**, which is why two
 * `ORDER BY` defects sat in it recorded but unfixed: `PLAN.md` §17 says the
 * text-alias bug was "fixed only where a test can prove it", and here nothing
 * could. `docs/reference/misc.md` also explains why unit tests cannot reach it —
 * the repository's db-mocking pattern stubs the Drizzle *query builder*, and
 * every query here is `db.execute(sql\`…\`)`.
 *
 * Same rules as `overview.service.itest.ts`: every expected number is a literal
 * with its arithmetic shown, derived by hand from `itest/support/fixture.ts`.
 * Computing an expectation from the corpus at runtime would mean
 * re-implementing the query in TypeScript and comparing the code with a copy of
 * itself.
 *
 * `DASH` is the fixture project for this file. Its counts — 10 error/api,
 * 9 warn/worker, 2 info/cron — are chosen so that ordering by count **as text**
 * and **as a number** disagree on the first element. See the fixture.
 */

let range: TimeRange;
let anchor: Date;

beforeAll(async () => {
    anchor = await readAnchor();
    const { from, to } = canonicalRange(anchor);
    // The service takes a `TimeRange` and resolves it itself. A preset would
    // re-anchor on `now()` and measure an empty window against a fixed corpus.
    range = { type: "custom", from: from.toISOString(), to: to.toISOString() };
});

// ── levelBreakdown ───────────────────────────────────────────────────────────

describe("levelBreakdown", () => {
    it("counts every level present in the range", async () => {
        const rows = await levelBreakdown(DASH, range);
        const byLevel = Object.fromEntries(rows.map((r) => [r.level, r.count]));

        // DASH inside the canonical hour: 10 error + 9 warn + 2 info.
        // The fatal at +40 min is inside the hour too; debug at +70 is not.
        expect(byLevel).toEqual({ error: 10, warn: 9, info: 2, fatal: 1 });
    });

    /**
     * The defect this file was written for.
     *
     * `SELECT COUNT(*)::text AS count … ORDER BY count DESC` binds to the text
     * alias, so "9" sorts above "10" and the busiest level is not first. It was
     * masked in the UI because `LevelBreakdownWidget` re-sorts, which is why it
     * survived — the data was wrong and the page looked right.
     */
    it("orders by count numerically, not as text", async () => {
        const rows = await levelBreakdown(DASH, range);

        expect(rows.map((r) => r.level)).toEqual(["error", "warn", "info", "fatal"]);
        // Stated separately so a failure says which property broke: text
        // ordering would put warn (9) ahead of error (10).
        expect(rows[0]).toEqual({ level: "error", count: 10 });
    });

    it("returns nothing for a project with no events", async () => {
        expect(await levelBreakdown(QUIET, range)).toEqual([]);
    });

    it("never counts another project's events", async () => {
        const rows = await levelBreakdown(DASH, range);
        const total = rows.reduce((sum, r) => sum + r.count, 0);

        expect(total).toBe(22); // 10 + 9 + 2 + 1, and nothing from ALPHA or BETA
    });
});

// ── topSources ───────────────────────────────────────────────────────────────

describe("topSources", () => {
    it("counts events per source", async () => {
        const rows = await topSources(DASH, range);
        const bySource = Object.fromEntries(rows.map((r) => [r.source, r.count]));

        expect(bySource).toEqual({ api: 10, worker: 9, cron: 2, "(unknown)": 1 });
    });

    it("labels a NULL source as (unknown)", async () => {
        const rows = await topSources(DASH, range);

        // The fatal at +40 min is the only row with no source.
        expect(rows.find((r) => r.source === "(unknown)")).toEqual({
            source: "(unknown)",
            count: 1,
        });
    });

    /**
     * The same text-alias defect, and here it is worse than an ordering
     * problem: `topSources` applies `LIMIT`, so a wrong sort returns the wrong
     * **rows**. Asking for the top 2 must not drop the busiest source.
     *
     * Text ordering gives "9" (worker), "2" (cron) — and `api`, the actual top
     * at 10, falls outside the limit entirely.
     */
    it("keeps the busiest source when a limit cuts the list", async () => {
        const rows = await topSources(DASH, range, 2);

        expect(rows.map((r) => r.source)).toEqual(["api", "worker"]);
    });

    it("orders by count numerically, not as text", async () => {
        const rows = await topSources(DASH, range);

        expect(rows.map((r) => r.count)).toEqual([10, 9, 2, 1]);
    });

    it("returns nothing for a project with no events", async () => {
        expect(await topSources(QUIET, range)).toEqual([]);
    });
});

// ── topMessages ──────────────────────────────────────────────────────────────

describe("topMessages", () => {
    /**
     * This one already ordered by `COUNT(*)` rather than by the alias, so it
     * never had the defect. Asserted anyway: the two neighbouring queries did
     * have it, and nothing but a test keeps them apart.
     */
    it("orders by count numerically", async () => {
        const rows = await topMessages(DASH, range);

        expect(rows.map((r) => r.message)).toEqual([
            "dash api failure", // 10
            "dash worker retry", // 9
            "dash cron tick", // 2
            "dash meltdown", // 1
        ]);
    });

    it("reports the dominant level and the latest occurrence per message", async () => {
        const [top] = await topMessages(DASH, range);

        expect(top.count).toBe(10);
        expect(top.dominantLevel).toBe("error");
        expect(top.latestAt.getTime()).toBe(anchor.getTime() + 5 * 60_000);
    });

    it("honours the limit", async () => {
        const rows = await topMessages(DASH, range, 2);

        expect(rows).toHaveLength(2);
        expect(rows[0].message).toBe("dash api failure");
    });

    it("excludes events outside the range", async () => {
        const messages = (await topMessages(DASH, range)).map((r) => r.message);

        expect(messages).not.toContain("dash noise"); // +70 min, past `to`
    });
});

// ── recentErrors ─────────────────────────────────────────────────────────────

describe("recentErrors", () => {
    it("returns only error and fatal levels", async () => {
        const rows = await recentErrors(DASH, range);

        expect(rows.every((r) => r.level === "error" || r.level === "fatal")).toBe(true);
        expect(rows.map((r) => r.message)).not.toContain("dash worker retry"); // warn
    });

    it("returns the newest first", async () => {
        const [first] = await recentErrors(DASH, range);

        // The fatal at +40 min is newer than the ten errors at +5.
        expect(first.message).toBe("dash meltdown");
        expect(first.timestamp.getTime()).toBe(anchor.getTime() + 40 * 60_000);
    });

    it("honours the limit", async () => {
        expect(await recentErrors(DASH, range, 3)).toHaveLength(3);
    });

    it("maps every column to its camelCase field", async () => {
        const [first] = await recentErrors(DASH, range);

        // The mapping is hand-written and column-by-column, so a renamed or
        // dropped column fails here rather than rendering as undefined.
        expect(first.projectId).toBe(DASH);
        expect(first.environment).toBe("production");
        expect(first.source).toBeNull();
        expect(first.timestamp).toBeInstanceOf(Date);
    });

    it("returns nothing for a project with no errors in the range", async () => {
        expect(await recentErrors(QUIET, range)).toEqual([]);
    });
});

// ── eventsPerMinute ──────────────────────────────────────────────────────────

describe("eventsPerMinute", () => {
    it("totals every level in the range", async () => {
        const buckets = await eventsPerMinute(DASH, range);
        const total = buckets.reduce((sum, b) => sum + b.total, 0);

        expect(total).toBe(22); // 10 + 9 + 2 + 1
    });

    it("splits each bucket by level", async () => {
        const buckets = await eventsPerMinute(DASH, range);
        const withEvents = buckets.filter((b) => b.total > 0);

        // Everything at +5 min lands in one bucket; the fatal at +40 in another.
        expect(withEvents).toHaveLength(2);
        expect(withEvents[0].byLevel).toEqual({ error: 10, warn: 9, info: 2 });
        expect(withEvents[1].byLevel).toEqual({ fatal: 1 });
    });

    it("zero-fills buckets with no events", async () => {
        const buckets = await eventsPerMinute(DASH, range);

        // A one-hour range buckets by minute, so the gap between +5 and +40 is
        // filled rather than absent — otherwise the chart would draw a line
        // straight across it.
        expect(buckets.length).toBeGreaterThan(2);
        expect(buckets.every((b) => typeof b.total === "number")).toBe(true);
        expect(buckets.some((b) => b.total === 0)).toBe(true);
    });

    it("returns buckets in ascending time order", async () => {
        const buckets = await eventsPerMinute(DASH, range);
        const times = buckets.map((b) => b.ts.getTime());

        expect(times).toEqual([...times].sort((a, b) => a - b));
    });

    it("returns only zero-filled buckets for a project with no events", async () => {
        const buckets = await eventsPerMinute(QUIET, range);

        expect(buckets.every((b) => b.total === 0)).toBe(true);
    });
});

// ── hasAnyEvents ─────────────────────────────────────────────────────────────

describe("hasAnyEvents", () => {
    it("is true for a project with events", async () => {
        expect(await hasAnyEvents(DASH)).toBe(true);
    });

    it("is false for a project with none", async () => {
        expect(await hasAnyEvents(QUIET)).toBe(false);
    });

    /**
     * It takes no range on purpose: it gates the onboarding screen, and a
     * project that was busy last month is not an empty project.
     */
    it("ignores the range entirely", async () => {
        // ALPHA's only events outside the canonical hour include one 40 days
        // old, well past every preset. It must still count as non-empty.
        expect(await hasAnyEvents(ALPHA)).toBe(true);
    });
});
