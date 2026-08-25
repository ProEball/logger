import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/core/db/client";
import {
    eventBucketsByLevel,
    errorsIn,
    environmentsInUse,
    emptyLevelledBucket,
    fillBuckets,
    hasAnyEvents,
    levelBreakdown,
    projectStats,
    recentErrors,
    topMessagePerProject,
    topMessages,
    topSources,
    type LevelledBucket,
} from "@/shared/services/event-aggregations.service";
import {
    markRollupDirty,
    rebuildRollupForProject,
} from "@/features/ingest/services/event-rollup.service";
import {
    ALPHA,
    BETA,
    COMMA_ENVIRONMENT,
    DASH,
    LONG_MESSAGE_GROUPED,
    ORG_B,
    canonicalRange,
    ORG_A_PROJECTS,
    QUIET,
} from "@/itest/support/fixture";
import { EVENT_LEVELS } from "@/shared/utils/event-filters.schema";
import { templateHashForStorage } from "@/features/ingest/utils/normalize-message";
import { readAnchor } from "@/itest/support/read-anchor";

/**
 * `eventBuckets` against a real database.
 *
 * Every expected number is a literal with its arithmetic shown, derived by hand
 * from `itest/support/fixture.ts`. None is computed from the corpus at runtime:
 * computing it would mean re-implementing the query in TypeScript and comparing
 * the code against a copy of itself (PROJECT.md §11).
 *
 * Corpus totals for the canonical one-hour range:
 *
 * | project | info | warn | error | fatal | total |
 * |---|---|---|---|---|---|
 * | ALPHA | 14 | 0 | 19 | 1 | 34 |
 * | BETA  |  6 | 2 |  9 | 0 | 17 |
 * | QUIET |  0 | 0 |  0 | 0 |  0 |
 *
 * ALPHA info = 1 anchor marker + 12 routine + 1 comma-env.
 * ALPHA error = 10 boom + 2 LONG_A + 2 LONG_B + 3 rare A + 2 rare B.
 * The other organization's 50 fatals must appear in none of it.
 *
 * ## What the shared corpus can and cannot reach
 *
 * The seeded database has **no rollup rows and no watermark**, so
 * `rollupBoundary` returns `null` for every fixture project, the rollup half of
 * the union selects nothing, and every assertion above is served entirely by the
 * raw-`events` half. That is a property of the suite, not of this file — the two
 * services this replaced were covered the same way, so the union's rollup branch
 * has never been exercised by an integration test.
 *
 * It is exercised here, in "rollup and raw tail" below, against a **project of
 * its own**. That is the fixture's stated rule for a test that needs to write,
 * and here it is load-bearing rather than tidy: building the rollup sets a
 * watermark, a watermark changes which branch `eventBuckets` takes, and
 * `fileParallelism` is on — so doing it to a fixture project would silently
 * change what every other test in the suite is measuring.
 */

let range: { from: Date; to: Date };
let anchor: Date;

beforeAll(async () => {
    anchor = await readAnchor();
    range = canonicalRange(anchor);
});

/** The one bucket for a project, when the width covers the whole range. */
function only(buckets: LevelledBucket[], projectId: string): LevelledBucket | undefined {
    const mine = buckets.filter((b) => b.projectId === projectId);
    expect(mine.length).toBeLessThanOrEqual(1);
    return mine[0];
}

describe("eventBuckets — scope", () => {
    it("returns nothing for an empty project list", async () => {
        // Guarded before the query rather than after: `ANY(ARRAY[])` is valid
        // SQL that matches nothing, so this is about not making the round trip.
        expect(await eventBucketsByLevel([], range, 3600)).toEqual([]);
    });

    it("counts each project separately over one hour-wide bucket", async () => {
        const buckets = await eventBucketsByLevel(ORG_A_PROJECTS, range, 3600);

        expect(only(buckets, ALPHA)?.total).toBe(34);
        expect(only(buckets, BETA)?.total).toBe(17);
    });

    it("splits counts by level", async () => {
        const buckets = await eventBucketsByLevel(ORG_A_PROJECTS, range, 3600);

        expect(only(buckets, ALPHA)?.byLevel).toEqual({ info: 14, error: 19, fatal: 1 });
        expect(only(buckets, BETA)?.byLevel).toEqual({ info: 6, warn: 2, error: 9 });
    });

    it("reports errors as error plus fatal", async () => {
        const buckets = await eventBucketsByLevel(ORG_A_PROJECTS, range, 3600);

        // ALPHA: 19 error + 1 fatal. BETA: 9 error + 0 fatal.
        expect(errorsIn(only(buckets, ALPHA)!)).toBe(20);
        expect(errorsIn(only(buckets, BETA)!)).toBe(9);
    });

    /**
     * A project with no events contributes no rows. That is the query's job;
     * turning it into a flat line is `fillBuckets`', and keeping the two apart
     * is what lets a caller tell "quiet" from "not asked about".
     */
    it("omits a project with no events rather than inventing a zero row", async () => {
        const buckets = await eventBucketsByLevel(ORG_A_PROJECTS, range, 3600);

        expect(buckets.some((b) => b.projectId === QUIET)).toBe(false);
    });

    /**
     * The fixture's other organization has 50 fatals in this range — deliberately
     * loud enough to dominate every aggregate here if scoping ever leaked.
     */
    it("never counts a project outside the requested scope", async () => {
        const buckets = await eventBucketsByLevel([ALPHA], range, 3600);

        expect(buckets.every((b) => b.projectId === ALPHA)).toBe(true);
        expect(only(buckets, ALPHA)?.total).toBe(34);
    });
});

describe("eventBuckets — range boundaries", () => {
    /**
     * The fixture places one ALPHA event at exactly `to`. `from` is inclusive
     * and `to` exclusive; counting the upper bound would double-count it in any
     * pair of adjacent ranges.
     */
    it("excludes an event landing exactly on the exclusive upper bound", async () => {
        const buckets = await eventBucketsByLevel([ALPHA], range, 3600);

        // 34, not 35: "alpha at upper bound" sits at offset 60 = `to`.
        expect(only(buckets, ALPHA)?.total).toBe(34);
    });

    it("includes an event landing exactly on the inclusive lower bound", async () => {
        const buckets = await eventBucketsByLevel([ALPHA], range, 3600);

        // The anchor marker is at offset 0. Without it ALPHA's info would be 13.
        expect(only(buckets, ALPHA)?.byLevel.info).toBe(14);
    });
});

describe("eventBuckets — bucket width", () => {
    /**
     * The arithmetic that replaced `date_trunc`. ALPHA's events sit at minutes
     * 0, 5, 10, 15, 20 and 25 after the anchor, so a 5-minute width must
     * separate them into six buckets whose totals sum back to 34.
     */
    it("splits one hour into five-minute buckets on the epoch grid", async () => {
        const buckets = (await eventBucketsByLevel([ALPHA], range, 300)).sort(
            (a, b) => a.ts.getTime() - b.ts.getTime(),
        );

        expect(buckets.map((b) => [(b.ts.getTime() - anchor.getTime()) / 60_000, b.total])).toEqual([
            [0, 1],   // anchor marker
            [5, 22],  // 12 routine info + 10 boom
            [10, 1],  // meltdown (fatal)
            [15, 1],  // comma-env info
            [20, 4],  // 2 LONG_A + 2 LONG_B
            [25, 5],  // 3 rare A + 2 rare B
        ]);
    });

    it("sums back to the same total at any width", async () => {
        const wide = await eventBucketsByLevel([ALPHA], range, 3600);
        const narrow = await eventBucketsByLevel([ALPHA], range, 300);

        const sum = (bs: LevelledBucket[]) => bs.reduce((n, b) => n + b.total, 0);
        expect(sum(narrow)).toBe(sum(wide));
    });

    /**
     * The anchor is an exact hour boundary, so a floored bucket must land on it
     * rather than on `from + n*width`. If the two ever diverge, `fillBuckets`
     * would generate timestamps that never match a real row and every bucket
     * would be doubled.
     */
    it("floors bucket starts to the epoch grid", async () => {
        const buckets = await eventBucketsByLevel([ALPHA], range, 3600);

        expect(only(buckets, ALPHA)?.ts.getTime()).toBe(anchor.getTime());
    });

    /**
     * Ported from `overview.service.itest.ts` when `getOrgEventBuckets` was
     * merged into this function. A project appearing in one bucket and not the
     * next is the ordinary case on a multi-hour chart, and it is the case a
     * per-project GROUP BY gets wrong if the project key is dropped.
     */
    it("splits a wider range into several buckets, per project", async () => {
        const twoHours = { from: anchor, to: new Date(anchor.getTime() + 120 * 60_000) };
        const buckets = await eventBucketsByLevel(ORG_A_PROJECTS, twoHours, 3600);

        // ALPHA in both hours, BETA only in the first: three rows.
        expect(buckets).toHaveLength(3);

        const second = buckets.filter((b) => b.ts.getTime() === anchor.getTime() + 3_600_000);
        expect(second).toHaveLength(1);
        expect(second[0].projectId).toBe(ALPHA);
        // 1 "alpha at upper bound" (offset 60) + 3 "alpha later" (offset 70).
        expect(second[0].total).toBe(4);
    });

    /**
     * A bucket nobody had events in is **absent**, not zero. Zero-filling is
     * `fillBuckets`' job and the caller's choice; doing it in SQL would make a
     * 30-day chart return a row per project per bucket regardless of traffic.
     */
    it("omits an empty bucket rather than returning a zero row", async () => {
        const threeHours = { from: anchor, to: new Date(anchor.getTime() + 180 * 60_000) };
        const buckets = await eventBucketsByLevel(ORG_A_PROJECTS, threeHours, 3600);

        // Nothing in the fixture lands in the third hour.
        expect(
            buckets.filter((b) => b.ts.getTime() === anchor.getTime() + 2 * 3_600_000),
        ).toEqual([]);
    });

    it("returns rows oldest first", async () => {
        const twoHours = { from: anchor, to: new Date(anchor.getTime() + 120 * 60_000) };
        const times = (await eventBucketsByLevel(ORG_A_PROJECTS, twoHours, 3600)).map((b) =>
            b.ts.getTime(),
        );

        expect(times).toEqual([...times].sort((a, b) => a - b));
    });
});

describe("eventBuckets — environment filter", () => {
    /**
     * The asymmetry this merge closed. `getOrgEventBuckets` took no environment
     * argument at all, so the volume chart ignored a filter that narrowed every
     * other widget on the page — recorded in `widgets.md` as the last one left.
     */
    it("narrows to one environment", async () => {
        const buckets = await eventBucketsByLevel(ORG_A_PROJECTS, range, 3600, ["production"]);

        // ALPHA production = 34 total − 1 staging fatal − 1 comma-env info.
        expect(only(buckets, ALPHA)?.total).toBe(32);
        // BETA's events are staging or NULL, so it drops out entirely.
        expect(only(buckets, BETA)).toBeUndefined();
    });

    it("keeps levels correct under a filter", async () => {
        const buckets = await eventBucketsByLevel(ORG_A_PROJECTS, range, 3600, ["staging"]);

        // ALPHA staging is the single fatal; BETA staging is its 9 errors.
        expect(only(buckets, ALPHA)?.byLevel).toEqual({ fatal: 1 });
        expect(only(buckets, BETA)?.byLevel).toEqual({ error: 9 });
    });

    /**
     * An event with no environment belongs to no environment. It is still
     * counted unfiltered, which is what makes this worth asserting: the two
     * paths must agree on everything except the predicate.
     */
    it("excludes events with a NULL environment", async () => {
        const filtered = await eventBucketsByLevel([BETA], range, 3600, ["staging"]);
        const unfiltered = await eventBucketsByLevel([BETA], range, 3600);

        // BETA: 9 staging errors, plus 6 info and 2 warn with no environment.
        expect(only(filtered, BETA)?.total).toBe(9);
        expect(only(unfiltered, BETA)?.total).toBe(17);
    });

    it("treats an empty environment list as no filter", async () => {
        const empty = await eventBucketsByLevel([ALPHA], range, 3600, []);

        // Not zero: `ANY(ARRAY[])` would match nothing and empty the chart.
        expect(only(empty, ALPHA)?.total).toBe(34);
    });

    /**
     * The filtered path reads raw `events` while the unfiltered path reads the
     * rollup plus a raw tail. Selecting every environment present must therefore
     * reproduce the unfiltered answer exactly — if it does not, the two paths
     * disagree and one of them is lying.
     */
    it("agrees with the unfiltered path when every environment is selected", async () => {
        const unfiltered = await eventBucketsByLevel([ALPHA], range, 3600);
        const allEnvs = await eventBucketsByLevel([ALPHA], range, 3600, [
            "production",
            "staging",
            "eu,prod",
        ]);

        expect(only(allEnvs, ALPHA)?.total).toBe(only(unfiltered, ALPHA)?.total);
        expect(only(allEnvs, ALPHA)?.byLevel).toEqual(only(unfiltered, ALPHA)?.byLevel);
    });
});

/**
 * The rollup branch, and the seam between it and the raw tail.
 *
 * Everything above this point is served by raw `events`, because the shared
 * corpus has no rollup. These tests build one — for a project they create
 * themselves, so no other test's branch selection changes underneath it.
 *
 * The property under test is the one the union exists for: **the answer must not
 * depend on where the boundary falls.** A rollup that disagreed with the events
 * it summarises would be invisible on a dashboard, because both halves return
 * plausible numbers.
 */
describe("eventBuckets — rollup and raw tail", () => {
    const PROJECT = "cccccccc-0000-4000-8000-000000000009";
    let rollupRange: { from: Date; to: Date };

    beforeAll(async () => {
        // Own project, own events: see the note at the top of this file.
        await db.execute(sql`DELETE FROM events WHERE project_id = ${PROJECT}::uuid`);
        await db.execute(sql`DELETE FROM rollup_state WHERE project_id = ${PROJECT}::uuid`);
        await db.execute(sql`DELETE FROM event_rollup_minutes WHERE project_id = ${PROJECT}::uuid`);
        await db.execute(sql`
            INSERT INTO projects (id, organization_id, name, slug)
            VALUES (${PROJECT}::uuid, ${ORG_B}::uuid, 'Rollup Seam', 'rollup-seam')
            ON CONFLICT (id) DO NOTHING
        `);

        // Four minutes, four distinct counts, so a dropped or doubled minute
        // changes the total rather than cancelling out: 3 + 1 + 4 + 2 = 10,
        // of which 1 fatal + 2 error = 3 are errors.
        const rows: Array<[number, string, number]> = [
            [0, "info", 3],
            [1, "fatal", 1],
            [2, "info", 4],
            [3, "error", 2],
        ];
        for (const [minute, level, count] of rows) {
            for (let i = 0; i < count; i++) {
                await db.execute(sql`
                    INSERT INTO events (id, project_id, timestamp, level, message, environment)
                    VALUES (
                        gen_random_uuid(),
                        ${PROJECT}::uuid,
                        ${anchor.toISOString()}::timestamptz + (${minute} || ' minutes')::interval,
                        ${level},
                        ${"seam " + level},
                        'production'
                    )
                `);
            }
        }

        rollupRange = { from: anchor, to: new Date(anchor.getTime() + 10 * 60_000) };

        // Build it with the real job, so what is measured is what the job writes.
        await markRollupDirty(PROJECT, anchor);
        for (let i = 0; i < 5; i++) {
            const [state] = await db.execute<{ refresh_from: Date }>(sql`
                SELECT refresh_from FROM rollup_state WHERE project_id = ${PROJECT}::uuid
            `);
            if (!state) break;
            const result = await rebuildRollupForProject(PROJECT, new Date(state.refresh_from));
            if (!result.hasMore) break;
        }
    });

    it("actually built a rollup — otherwise the tests below prove nothing", async () => {
        const [row] = await db.execute<{ n: string; boundary: Date | null }>(sql`
            SELECT
                (SELECT COUNT(*)::text FROM event_rollup_minutes WHERE project_id = ${PROJECT}::uuid) AS n,
                (SELECT rolled_up_to FROM rollup_state WHERE project_id = ${PROJECT}::uuid)           AS boundary
        `);

        // Four minutes had events, and only minutes with events get a row.
        expect(Number(row.n)).toBe(4);
        expect(row.boundary).not.toBeNull();
    });

    it("reads the whole range from the rollup when it is fully covered", async () => {
        const buckets = await eventBucketsByLevel([PROJECT], rollupRange, 3600);

        expect(only(buckets, PROJECT)?.total).toBe(10);
        expect(only(buckets, PROJECT)?.byLevel).toEqual({ info: 7, fatal: 1, error: 2 });
        expect(errorsIn(only(buckets, PROJECT)!)).toBe(3);
    });

    /**
     * The seam itself. With the boundary pulled back two minutes, minutes 0–1
     * come from the rollup and minutes 2–3 from raw `events`. The total must not
     * move — a double-count would read 14 and a dropped half would read 4 or 6.
     */
    it("gives the same answer with the boundary in the middle of the range", async () => {
        const whole = await eventBucketsByLevel([PROJECT], rollupRange, 3600);

        await db.execute(sql`
            UPDATE rollup_state
            SET rolled_up_to = ${anchor.toISOString()}::timestamptz + interval '2 minutes'
            WHERE project_id = ${PROJECT}::uuid
        `);
        const split = await eventBucketsByLevel([PROJECT], rollupRange, 3600);

        expect(only(split, PROJECT)?.total).toBe(10);
        expect(only(split, PROJECT)?.byLevel).toEqual(only(whole, PROJECT)?.byLevel);
    });

    /**
     * Per-minute, so a bucket boundary landing on the seam is covered too: the
     * rollup's grain is a minute and the raw tail is grouped from timestamps, so
     * the two must produce identical bucket starts or the minute at the seam
     * would appear twice.
     */
    it("keeps per-minute buckets aligned across the seam", async () => {
        const buckets = (await eventBucketsByLevel([PROJECT], rollupRange, 60)).sort(
            (a, b) => a.ts.getTime() - b.ts.getTime(),
        );

        expect(
            buckets.map((b) => [(b.ts.getTime() - anchor.getTime()) / 60_000, b.total]),
        ).toEqual([
            [0, 3],
            [1, 1],
            [2, 4],
            [3, 2],
        ]);
    });
});

/**
 * Org-wide totals for the canonical range, summed across ALPHA and BETA:
 * error 19 + 9 = 28 · info 14 + 6 = 20 · warn 0 + 2 = 2 · fatal 1 + 0 = 1.
 * Total 51, which is what the header comment records.
 */
/**
 * The composition the project dashboard performs: query, then zero-fill. Each
 * half is covered on its own -- the query here, the fill in
 * `shared/utils/event-buckets.test.ts` -- but the chart depends on them lining
 * up, and a filled timestamp that misses a real one by a second would double
 * every bucket without either test noticing.
 */
describe("eventBuckets + fillBuckets", () => {
    it("fills the gap between two active minutes rather than leaving it absent", async () => {
        // DASH has events at +5 minutes and a fatal at +40. At minute grain
        // the 34 minutes between them must be present and zero, or the chart
        // draws a straight line across a period it knows nothing about.
        const raw = await eventBucketsByLevel([DASH], range, 60);
        const filled = fillBuckets(raw, [DASH], range, 60, emptyLevelledBucket);

        expect(raw).toHaveLength(2);
        expect(filled).toHaveLength(60);
        expect(filled.filter((b) => b.total > 0)).toHaveLength(2);
    });

    it("keeps every filled timestamp on the same grid as a real one", async () => {
        const raw = await eventBucketsByLevel([DASH], range, 60);
        const filled = fillBuckets(raw, [DASH], range, 60, emptyLevelledBucket);

        // Every real bucket appears exactly once after filling. If the grids
        // disagreed it would appear twice -- once real, once zeroed.
        for (const b of raw) {
            expect(filled.filter((f) => f.ts.getTime() === b.ts.getTime())).toHaveLength(1);
        }
    });

    it("gives a project with no events a full flat series", async () => {
        const filled = fillBuckets(await eventBucketsByLevel([QUIET], range, 60), [QUIET], range, 60, emptyLevelledBucket);

        expect(filled).toHaveLength(60);
        expect(filled.every((b) => b.total === 0)).toBe(true);
    });
});

describe("levelBreakdown", () => {
    it("returns nothing for an empty project list", async () => {
        expect(await levelBreakdown([], range)).toEqual([]);
    });

    it("sums one project's levels", async () => {
        const rows = await levelBreakdown([ALPHA], range);

        expect(Object.fromEntries(rows.map((r) => [r.level, r.count]))).toEqual({
            info: 14,
            error: 19,
            fatal: 1,
        });
    });

    it("sums across every project in scope", async () => {
        const rows = await levelBreakdown(ORG_A_PROJECTS, range);

        expect(Object.fromEntries(rows.map((r) => [r.level, r.count]))).toEqual({
            error: 28,
            info: 20,
            warn: 2,
            fatal: 1,
        });
    });

    /**
     * The defect this ordering guards against. `COUNT(*)::text` makes the output
     * alias text, and `ORDER BY count DESC` binds to that alias — so Postgres
     * sorts lexicographically and ranks "9" above "10". It shipped twice and hid
     * both times because the widget re-sorts on the client: the data was wrong
     * and the page looked right.
     *
     * **Scoped to DASH deliberately.** Written first against `ORG_A_PROJECTS` and
     * caught by mutation: org-wide the levels are 28/20/2/1, whose text and
     * numeric orders are identical, so the assertion held with the defect
     * reintroduced and measured nothing. DASH is the project the fixture builds
     * for exactly this — its 10/9/2 is the pair whose two orderings disagree on
     * the **first** element, and its comment says the counts "must not be
     * tidied". They are the reason this test can fail.
     *
     * Numeric: error 10, warn 9, info 2, fatal 1.
     * As text: "9" warn, "2" info, "10" error, "1" fatal.
     */
    it("orders by the number, not by the text of the number", async () => {
        const rows = await levelBreakdown([DASH], range);

        expect(rows.map((r) => [r.level, r.count])).toEqual([
            ["error", 10],
            ["warn", 9],
            ["info", 2],
            ["fatal", 1],
        ]);
    });

    it("never counts a project outside the requested scope", async () => {
        // The other organization's 50 fatals would dominate `fatal` entirely.
        const rows = await levelBreakdown(ORG_A_PROJECTS, range);

        expect(rows.find((r) => r.level === "fatal")?.count).toBe(1);
    });

    /** Ported from `aggregations.service.itest.ts` when the two merged. */
    it("returns nothing for a project with no events", async () => {
        expect(await levelBreakdown([QUIET], range)).toEqual([]);
    });

    it("counts only the scope it was given, across organizations", async () => {
        // DASH lives in org B. Its 22 events must not pick up org A's 51.
        const total = (await levelBreakdown([DASH], range)).reduce((s, r) => s + r.count, 0);

        expect(total).toBe(22); // 10 error + 9 warn + 2 info + 1 fatal
    });

    it("excludes an event on the exclusive upper bound", async () => {
        // "alpha at upper bound" is an info event at exactly `to`.
        const rows = await levelBreakdown([ALPHA], range);

        expect(rows.find((r) => r.level === "info")?.count).toBe(14);
    });

    describe("under an environment filter", () => {
        it("narrows to the selected environment", async () => {
            const rows = await levelBreakdown(ORG_A_PROJECTS, range, ["staging"]);

            // ALPHA's single staging fatal, plus BETA's 9 staging errors.
            expect(Object.fromEntries(rows.map((r) => [r.level, r.count]))).toEqual({
                error: 9,
                fatal: 1,
            });
        });

        it("excludes events carrying no environment", async () => {
            const rows = await levelBreakdown([BETA], range, ["staging"]);

            // BETA's 6 info and 2 warn have a NULL environment.
            expect(rows.map((r) => r.level)).toEqual(["error"]);
        });

        it("treats an empty list as no filter", async () => {
            const empty = await levelBreakdown([ALPHA], range, []);
            const none = await levelBreakdown([ALPHA], range);

            expect(empty).toEqual(none);
        });

        /**
         * The filtered path reads raw `events`; the unfiltered one reads the
         * rollup plus a raw tail. Selecting every environment present must
         * reproduce the unfiltered answer, or the two paths disagree and one is
         * lying. ALPHA is the project that uses all three.
         */
        it("agrees with the unfiltered path when every environment is selected", async () => {
            const unfiltered = await levelBreakdown([ALPHA], range);
            const all = await levelBreakdown([ALPHA], range, [
                "production",
                "staging",
                COMMA_ENVIRONMENT,
            ]);

            expect(all).toEqual(unfiltered);
        });
    });
});

/**
 * Message groups in the canonical range, by project:
 *
 * ALPHA — anchor marker 1 info · alpha routine 12 info · alpha boom 10 error ·
 *         alpha meltdown 1 fatal · alpha comma env 1 info ·
 *         LONG_A 2 + LONG_B 2 error (**one group** past 200 chars) ·
 *         alpha rare A 3 error · alpha rare B 2 error
 * BETA  — beta boom 9 error · beta routine 6 info · beta warning 2 warn
 * DASH  — dash api failure 10 error · dash worker retry 9 warn ·
 *         dash cron tick 2 info · dash meltdown 1 fatal
 *
 * The shared corpus carries no template rollup, so everything here exercises
 * the raw-`events` path. The rollup path is covered separately below, against a
 * project this file creates.
 */
describe("topMessages", () => {
    it("returns nothing for an empty project list", async () => {
        expect(await topMessages([], range)).toEqual([]);
    });

    it("ranks a single project's messages, every level", async () => {
        const rows = await topMessages([DASH], range);

        expect(rows.map((r) => [r.message, r.count])).toEqual([
            ["dash api failure", 10],
            ["dash worker retry", 9],
            ["dash cron tick", 2],
            ["dash meltdown", 1],
        ]);
    });

    /**
     * DASH again, and for the same reason as `levelBreakdown`: 10 / 9 / 2 is
     * the triple whose text and numeric orders disagree on the **first**
     * element. Ranking by the `count` alias would put "9" first.
     */
    it("orders by the number, not by the text of the number", async () => {
        const rows = await topMessages([DASH], range);

        expect(rows[0]).toMatchObject({ message: "dash api failure", count: 10 });
    });

    it("badges each message with its dominant level", async () => {
        const rows = await topMessages([DASH], range);
        const byMessage = Object.fromEntries(rows.map((r) => [r.message, r.dominantLevel]));

        expect(byMessage).toEqual({
            "dash api failure": "error",
            "dash worker retry": "warn",
            "dash cron tick": "info",
            "dash meltdown": "fatal",
        });
    });

it("reports the latest occurrence of each message", async () => {
        const [top] = await topMessages([DASH], range);

        // "dash api failure" is ten events, all at anchor + 5 minutes.
        expect(top.latestAt.getTime()).toBe(anchor.getTime() + 5 * 60_000);
    });

    /**
     * Ported from `aggregations.service.itest.ts` when the two merged. It
     * iterates `EVENT_LEVELS` rather than naming five levels, so adding a sixth
     * to the schema without adding its `COUNT(*) FILTER` alias fails here. The
     * SQL restates the level list instead of deriving it — generating aliases
     * into raw SQL for a fixed five-element enum is worse — and this test is
     * what covers the drift that restatement costs.
     *
     * A wider window than the canonical hour on purpose: DASH puts its debug
     * message 70 minutes past the anchor. Covering all five counters needs all
     * five messages, so this one test reaches past that boundary.
     */
    it("returns a dominant level for every level the schema defines", async () => {
        const wide = { from: anchor, to: new Date(anchor.getTime() + 120 * 60_000) };
        const rows = await topMessages([DASH], wide);

        expect([...new Set(rows.map((r) => r.dominantLevel))].sort()).toEqual(
            [...EVENT_LEVELS].sort(),
        );
    });

    it("attributes every row to a project", async () => {
        const rows = await topMessages([DASH], range);

        expect(rows.every((r) => r.projectId === DASH)).toBe(true);
    });

    /**
     * The fixture's two long messages differ only past character 200, and the
     * raw path groups on `SUBSTRING(message, 1, 200)`. Two rows of 2 must
     * therefore appear as one row of 4 — the reason those fixtures exist.
     */
    it("groups messages identical through their first 200 characters", async () => {
        const rows = await topMessages([ALPHA], range, { levels: ["error", "fatal"] });
        const grouped = rows.find((r) => r.message.startsWith(LONG_MESSAGE_GROUPED));

        expect(grouped?.count).toBe(4);
        expect(grouped?.message).toBe(LONG_MESSAGE_GROUPED);
        // Exactly the truncation width, not one character either side.
        expect(grouped?.message).toHaveLength(200);
    });

    /**
     * The `levels` option is what makes the widget's title true. It was a
     * caller-supplied override until 2026-08-20, when the overview's level
     * filter — its only caller — was removed: a list titled "top errors" that
     * could be asked for warnings is a defect waiting for a second caller.
     * It is now a constant each dashboard passes, and this pins what it excludes.
     */
    it("excludes levels outside the restriction, and keeps fatal inside it", async () => {
        const messages = (
            await topMessages(ORG_A_PROJECTS, range, {
                levels: ["error", "fatal"],
                limit: 50,
            })
        ).map((r) => r.message);

        expect(messages).not.toContain("alpha routine"); // info
        expect(messages).not.toContain("beta warning"); // warn
        expect(messages).toContain("alpha meltdown"); // fatal counts as an error
    });

    it("honours the limit, dropping the smallest groups", async () => {
        const rows = await topMessages([DASH], range, { limit: 2 });

        expect(rows.map((r) => r.count)).toEqual([10, 9]);
    });

    describe("across several projects", () => {
        /**
         * What the overview's "top errors" widget asks: error and fatal only,
         * across every project, top five. The sixth group — ALPHA's single
         * fatal meltdown — is what the limit cuts, which is why the fixture
         * carries exactly six.
         */
        it("ranks errors across the organization and attributes each", async () => {
            const rows = await topMessages(ORG_A_PROJECTS, range, {
                levels: ["error", "fatal"],
                limit: 5,
            });

            expect(rows.map((r) => [r.message, r.count, r.projectId])).toEqual([
                ["alpha boom", 10, ALPHA],
                ["beta boom", 9, BETA],
                [LONG_MESSAGE_GROUPED, 4, ALPHA],
                ["alpha rare A", 3, ALPHA],
                ["alpha rare B", 2, ALPHA],
            ]);
        });

        it("drops the sixth group at the limit, not a different one", async () => {
            const rows = await topMessages(ORG_A_PROJECTS, range, {
                levels: ["error", "fatal"],
                limit: 5,
            });

            // "alpha meltdown" is the single fatal, count 1 — the smallest.
            expect(rows.map((r) => r.message)).not.toContain("alpha meltdown");
        });

        it("returns every group when the limit is raised above their number", async () => {
            const rows = await topMessages(ORG_A_PROJECTS, range, {
                levels: ["error", "fatal"],
                limit: 50,
            });

            expect(rows).toHaveLength(6);
            expect(rows.at(-1)).toMatchObject({ message: "alpha meltdown", count: 1 });
        });

        it("never reaches a project outside the scope", async () => {
            // The other organization's 50 fatals share no message with these,
            // so a leak would show up as a new top row rather than a bigger one.
            const rows = await topMessages(ORG_A_PROJECTS, range, { levels: ["error", "fatal"] });

            expect(rows.map((r) => r.message)).not.toContain("other org noise");
        });
    });

    describe("level restriction", () => {
        it("counts only the named levels", async () => {
            // DASH: 10 error + 1 fatal are errors; 9 warn and 2 info are not.
            const rows = await topMessages([DASH], range, { levels: ["error", "fatal"] });

            expect(rows.map((r) => [r.message, r.count])).toEqual([
                ["dash api failure", 10],
                ["dash meltdown", 1],
            ]);
        });

        /**
         * A widget titled "top errors" must not badge a row `info`. Without
         * zeroing the counters outside the restriction, a template with many
         * info lines and a few errors would rank on its errors and be badged on
         * its info — the badge describing the template while the number beside
         * it described something else.
         */
        it("picks the dominant level from the restricted counters only", async () => {
            const rows = await topMessages([ALPHA], range, { levels: ["error", "fatal"] });

            expect(rows.every((r) => r.dominantLevel === "error" || r.dominantLevel === "fatal"))
                .toBe(true);
        });
    });

    describe("under an environment filter", () => {
        it("narrows to the selected environment", async () => {
            const rows = await topMessages([ALPHA], range, { environments: ["staging"] });

            // ALPHA's only staging event is the single fatal meltdown.
            expect(rows.map((r) => [r.message, r.count])).toEqual([["alpha meltdown", 1]]);
        });

        it("treats an empty list as no filter", async () => {
            const empty = await topMessages([DASH], range, { environments: [] });
            const none = await topMessages([DASH], range);

            expect(empty).toEqual(none);
        });
    });
});

/**
 * `topMessages` served from the template rollup.
 *
 * Everything in the `topMessages` block above runs on the raw-`events` path,
 * because the shared corpus carries no fingerprints. This block builds a real
 * template rollup for a project of its own — and it is not duplication, because
 * **one property here cannot be tested on the raw path at all**.
 *
 * On the raw path a level restriction is a `WHERE` predicate, so the counters
 * for excluded levels are necessarily zero and `toTopMessage`'s zeroing is
 * redundant. On the rollup path the counters are *stored*, and a template with
 * many `info` lines and a couple of `error`s keeps `n_info = many`. Without the
 * zeroing that row ranks on its errors and is badged `info` — in a widget
 * titled "top errors". The fixture below is that exact shape.
 */
describe("topMessages — from the template rollup", () => {
    const PROJECT = "cccccccc-0000-4000-8000-00000000000a";
    const MOSTLY_INFO = "seam mostly info";
    const ALL_ERROR = "seam all error";
    let rollupRange: { from: Date; to: Date };

    beforeAll(async () => {
        await db.execute(sql`DELETE FROM events WHERE project_id = ${PROJECT}::uuid`);
        await db.execute(sql`DELETE FROM rollup_state WHERE project_id = ${PROJECT}::uuid`);
        await db.execute(sql`DELETE FROM event_template_rollup WHERE project_id = ${PROJECT}::uuid`);
        await db.execute(sql`DELETE FROM message_templates WHERE project_id = ${PROJECT}::uuid`);
        await db.execute(sql`
            INSERT INTO projects (id, organization_id, name, slug)
            VALUES (${PROJECT}::uuid, ${ORG_B}::uuid, 'Template Rollup', 'template-rollup')
            ON CONFLICT (id) DO NOTHING
        `);

        // 8 info + 2 error on one template, 3 error on another. Restricted to
        // errors the ranking is 3 then 2; the badge on the first template is
        // the property under test.
        const rows: Array<[string, string, number]> = [
            [MOSTLY_INFO, "info", 8],
            [MOSTLY_INFO, "error", 2],
            [ALL_ERROR, "error", 3],
        ];
        for (const [message, level, count] of rows) {
            for (let i = 0; i < count; i++) {
                await db.execute(sql`
                    INSERT INTO events (id, project_id, timestamp, level, message, template_hash)
                    VALUES (
                        gen_random_uuid(), ${PROJECT}::uuid,
                        ${anchor.toISOString()}::timestamptz + interval '1 minute',
                        ${level}, ${message},
                        ${templateHashForStorage(message).toString()}::bigint
                    )
                `);
            }
        }
        // The registry is written at ingest, not by the rollup job, so a test
        // inserting events directly must supply it or every message reads
        // "(unknown template)".
        for (const message of [MOSTLY_INFO, ALL_ERROR]) {
            await db.execute(sql`
                INSERT INTO message_templates (project_id, template_hash, template, normalizer_version)
                VALUES (
                    ${PROJECT}::uuid,
                    ${templateHashForStorage(message).toString()}::bigint,
                    ${message}, 1
                ) ON CONFLICT DO NOTHING
            `);
        }

        rollupRange = { from: anchor, to: new Date(anchor.getTime() + 10 * 60_000) };

        await markRollupDirty(PROJECT, anchor);
        for (let i = 0; i < 5; i++) {
            const [state] = await db.execute<{ refresh_from: Date }>(sql`
                SELECT refresh_from FROM rollup_state WHERE project_id = ${PROJECT}::uuid
            `);
            if (!state) break;
            const result = await rebuildRollupForProject(PROJECT, new Date(state.refresh_from));
            if (!result.hasMore) break;
        }
    });

    it("actually built a template rollup — otherwise the tests below prove nothing", async () => {
        const [row] = await db.execute<{ n: string }>(sql`
            SELECT COUNT(*)::text AS n FROM event_template_rollup
            WHERE project_id = ${PROJECT}::uuid
        `);

        // Two templates, both in the same minute.
        expect(Number(row.n)).toBe(2);
    });

    it("reads counts and display text from the rollup", async () => {
        const rows = await topMessages([PROJECT], rollupRange);

        expect(rows.map((r) => [r.message, r.count])).toEqual([
            [MOSTLY_INFO, 10], // 8 info + 2 error
            [ALL_ERROR, 3],
        ]);
    });

    it("ranks on the restricted levels, not on the template's total", async () => {
        const rows = await topMessages([PROJECT], rollupRange, { levels: ["error", "fatal"] });

        // Unrestricted, MOSTLY_INFO (10) outranks ALL_ERROR (3). Restricted to
        // errors it is 2 against 3, so the order inverts.
        expect(rows.map((r) => [r.message, r.count])).toEqual([
            [ALL_ERROR, 3],
            [MOSTLY_INFO, 2],
        ]);
    });

    /**
     * The property the raw path cannot reach. `MOSTLY_INFO` keeps `n_info = 8`
     * in the rollup; without zeroing the counters outside the restriction,
     * `pickDominantLevel` badges it `info` in a list of top **errors**.
     */
    it("badges a mostly-info template as an error when errors are what was asked for", async () => {
        const rows = await topMessages([PROJECT], rollupRange, { levels: ["error", "fatal"] });
        const mostlyInfo = rows.find((r) => r.message === MOSTLY_INFO);

        expect(mostlyInfo?.dominantLevel).toBe("error");
    });

    it("badges it info when no restriction was asked for", async () => {
        const rows = await topMessages([PROJECT], rollupRange);
        const mostlyInfo = rows.find((r) => r.message === MOSTLY_INFO);

        expect(mostlyInfo?.dominantLevel).toBe("info");
    });

    /**
     * A template that never occurred at a restricted level must not appear at
     * all — that is what the `HAVING` does. Without it the row would rank with
     * a count of zero and `pickDominantLevel` would be handed an all-zero map.
     */
    it("drops a template with no events at any restricted level", async () => {
        const rows = await topMessages([PROJECT], rollupRange, { levels: ["fatal"] });

        expect(rows).toEqual([]);
    });
});

// ── topSources ───────────────────────────────────────────────────────────────

describe("topSources", () => {
    it("counts events per source", async () => {
        const rows = await topSources([DASH], range);
        const bySource = Object.fromEntries(rows.map((r) => [r.source, r.count]));

        expect(bySource).toEqual({ api: 10, worker: 9, cron: 2, "(unknown)": 1 });
    });

    it("labels a NULL source as (unknown)", async () => {
        const rows = await topSources([DASH], range);

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
        const rows = await topSources([DASH], range, { limit: 2 });

        expect(rows.map((r) => r.source)).toEqual(["api", "worker"]);
    });

    it("orders by count numerically, not as text", async () => {
        const rows = await topSources([DASH], range);

        expect(rows.map((r) => r.count)).toEqual([10, 9, 2, 1]);
    });

    it("returns nothing for a project with no events", async () => {
        expect(await topSources([QUIET], range)).toEqual([]);
    });
});

// ── recentErrors ─────────────────────────────────────────────────────────────

describe("recentErrors", () => {
    it("returns only error and fatal levels", async () => {
        const rows = await recentErrors([DASH], range);

        expect(rows.every((r) => r.level === "error" || r.level === "fatal")).toBe(true);
        expect(rows.map((r) => r.message)).not.toContain("dash worker retry"); // warn
    });

    it("returns the newest first", async () => {
        const [first] = await recentErrors([DASH], range);

        // The fatal at +40 min is newer than the ten errors at +5.
        expect(first.message).toBe("dash meltdown");
        expect(first.timestamp.getTime()).toBe(anchor.getTime() + 40 * 60_000);
    });

    it("honours the limit", async () => {
        expect(await recentErrors([DASH], range, { limit: 3 })).toHaveLength(3);
    });

    it("maps every column to its camelCase field", async () => {
        const [first] = await recentErrors([DASH], range);

        // The mapping is hand-written and column-by-column, so a renamed or
        // dropped column fails here rather than rendering as undefined.
        expect(first.projectId).toBe(DASH);
        expect(first.environment).toBe("production");
        expect(first.source).toBeNull();
        expect(first.timestamp).toBeInstanceOf(Date);
    });

    it("returns nothing for a project with no errors in the range", async () => {
        expect(await recentErrors([QUIET], range)).toEqual([]);
    });
});

// ── hasAnyEvents ─────────────────────────────────────────────────────────────

describe("hasAnyEvents", () => {
    it("is true for a project with events", async () => {
        expect(await hasAnyEvents([DASH])).toBe(true);
    });

    it("is false for a project with none", async () => {
        expect(await hasAnyEvents([QUIET])).toBe(false);
    });

    /**
     * It takes no range on purpose: it gates the onboarding screen, and a
     * project that was busy last month is not an empty project.
     */
    it("ignores the range entirely", async () => {
        // ALPHA's only events outside the canonical hour include one 40 days
        // old, well past every preset. It must still count as non-empty.
        expect(await hasAnyEvents([ALPHA])).toBe(true);
    });
});

// ── projectStats ──────────────────────────────────────────────────────────

describe("projectStats", () => {
    it("returns an empty map for no projects without querying", async () => {
        expect(await projectStats([], range)).toEqual(new Map());
    });

    it("counts every event in the range per project", async () => {
        const map = await projectStats(ORG_A_PROJECTS, range);
        expect(map.get(ALPHA)?.totalEvents).toBe(34); // 1+12+10+1+1+2+2+3+2
        expect(map.get(BETA)?.totalEvents).toBe(17); // 9+6+2
    });

    it("counts fatal as an error", async () => {
        const map = await projectStats(ORG_A_PROJECTS, range);
        expect(map.get(ALPHA)?.errorCount).toBe(20); // 10 boom +1 fatal +2+2 long +3+2 rare
        expect(map.get(BETA)?.errorCount).toBe(9);
    });

    it("omits a project with no events entirely, rather than returning zeros", async () => {
        // The caller (`buildProjectRows`) is what turns a missing entry into a
        // zeroed row; the service itself simply has no row to return.
        const map = await projectStats(ORG_A_PROJECTS, range);
        expect(map.has(QUIET)).toBe(false);
    });

    it("excludes an event sitting exactly on the exclusive upper bound", async () => {
        // "alpha at upper bound" is at anchor+60m, which is `to`.
        const map = await projectStats(ORG_A_PROJECTS, range);
        expect(map.get(ALPHA)?.totalEvents).toBe(34);

        const wider = { from: range.from, to: new Date(range.to.getTime() + 1) };
        expect((await projectStats(ORG_A_PROJECTS, wider)).get(ALPHA)?.totalEvents).toBe(35);
    });

    it("includes an event sitting exactly on the inclusive lower bound", async () => {
        const later = { from: new Date(range.from.getTime() + 1), to: range.to };
        // Losing only the anchor marker itself.
        expect((await projectStats(ORG_A_PROJECTS, later)).get(ALPHA)?.totalEvents).toBe(33);
    });

    it("never counts events belonging to another organization", async () => {
        // The other org has 50 fatals in this range. Asking for org A's
        // projects must not see them under any aggregate.
        const map = await projectStats(ORG_A_PROJECTS, range);
        const total = [...map.values()].reduce((s, r) => s + r.totalEvents, 0);
        expect(total).toBe(51); // 34 + 17, not 101
    });

    it("lists a project's environments, excluding NULL", async () => {
        const map = await projectStats(ORG_A_PROJECTS, range);
        // Beta's info and warn events carry no environment at all.
        expect(map.get(BETA)?.environments).toEqual(["staging"]);
    });

    it("keeps an environment name that contains a comma intact", async () => {
        // Fixed 2026-08-20 when the pills moved to the rollup. The old query
        // joined environments with `STRING_AGG(…, ',')` and split the result on
        // "," in TypeScript, so "eu,prod" — a value the ingest schema accepts,
        // since `environment` is validated only as a string — arrived as two
        // environments. The rollup stores them as JSON keys and they come back
        // as a real array, so there is nothing left to split.
        //
        // This assertion was inverted from the pinned bug rather than replaced:
        // it is the same check, now expecting the right answer.
        const map = await projectStats(ORG_A_PROJECTS, range);
        const envs = map.get(ALPHA)?.environments ?? [];

        expect(envs).toEqual([COMMA_ENVIRONMENT, "production", "staging"]);
        expect(envs).not.toContain("eu");
    });

    // Removed 2026-08-20 with the level filter itself: "applies a level filter
    // to the event counts" and "KNOWN BUG: a level filter does not reach the
    // top-message query". The second pinned a defect that only existed because
    // the two queries disagreed about a filter neither now receives — deleting
    // the filter deleted the disagreement. See `DashboardFilterBar.tsx`.

    it("applies an environment filter to the event counts", async () => {
        const map = await projectStats(ORG_A_PROJECTS, range, ["production"]);
        expect(map.get(ALPHA)?.totalEvents).toBe(32); // 34 less the staging fatal and the comma env
        // Beta has nothing in production at all.
        expect(map.has(BETA)).toBe(false);
    });

    it("returns nothing for a range that contains no events", async () => {
        const quiet = {
            from: new Date(anchor.getTime() - 3 * 60 * 60_000),
            to: new Date(anchor.getTime() - 2 * 60 * 60_000),
        };
        expect((await projectStats(ORG_A_PROJECTS, quiet)).size).toBe(0);
    });
});

// ── topMessagePerProject ────────────────────────────────────────────────────

/**
 * Split out of `projectStats` on 2026-08-20. The assertions here were part
 * of that suite; they moved rather than disappeared, because the behaviour did
 * not change — only which promise carries it.
 */
describe("topMessagePerProject", () => {
    it("returns an empty map for no projects", async () => {
        expect(await topMessagePerProject([], range)).toEqual(new Map());
    });

    it("reports the most frequent error message per project", async () => {
        const map = await topMessagePerProject(ORG_A_PROJECTS, range);
        expect(map.get(ALPHA)?.message).toBe("alpha boom"); // 10, the most of any
        expect(map.get(ALPHA)?.level).toBe("error");
        expect(map.get(BETA)?.message).toBe("beta boom");
    });

    it("omits a project with no errors rather than mapping it to null", async () => {
        const quiet = {
            from: new Date(anchor.getTime() - 3 * 60 * 60_000),
            to: new Date(anchor.getTime() - 2 * 60 * 60_000),
        };
        expect((await topMessagePerProject(ORG_A_PROJECTS, quiet)).size).toBe(0);
    });

    it("never reaches another organization's events", async () => {
        const map = await topMessagePerProject(ORG_A_PROJECTS, range);
        expect([...map.values()].map((v) => v.message)).not.toContain("other org noise");
    });
});

// ── environmentsInUse ───────────────────────────────────────────────────────

describe("environmentsInUse", () => {
    it("returns nothing for no projects", async () => {
        expect(await environmentsInUse([])).toEqual([]);
    });

    it("labels a NULL environment and sorts the list", async () => {
        // "(unset)" lands last, not first: `ORDER BY environment` uses the
        // database collation, which weights punctuation below letters, so the
        // value sorts as if it were "unset". Under a plain ASCII ordering the
        // parenthesis would have put it first. The UI shows the list in this
        // order, so the placeholder appears at the end of the dropdown.
        const envs = await environmentsInUse(ORG_A_PROJECTS);
        expect(envs).toEqual(["archive", COMMA_ENVIRONMENT, "production", "staging", "(unset)"]);
    });

    it("looks back exactly 30 days regardless of the page's selected range", async () => {
        // "archive" is 20 days old and appears; "legacy" is 40 days old and
        // does not — even though the function takes no range argument at all,
        // which is the point: the dropdown ignores the filter bar above it and
        // scans 30 days on every page load. Recorded as a Stage D target.
        const envs = await environmentsInUse(ORG_A_PROJECTS);
        expect(envs).toContain("archive");
        expect(envs).not.toContain("legacy");
    });
});


/**
 * The environment key, end to end.
 *
 * `environment` joined the rollup's primary key on 2026-08-25 so that a filtered
 * read stops scanning raw `events`. These tests build a real rollup for a
 * project of their own and check the two things that can go wrong with that:
 * the filtered answer must **match** the unfiltered arithmetic, and a minute
 * that folded environments into `(other)` must **not** be used for a filtered
 * read at all.
 */
describe("environment as a rollup key", () => {
    const PROJECT = "cccccccc-0000-4000-8000-00000000000b";
    let envRange: { from: Date; to: Date };

    beforeAll(async () => {
        await db.execute(sql`DELETE FROM events WHERE project_id = ${PROJECT}::uuid`);
        await db.execute(sql`DELETE FROM rollup_state WHERE project_id = ${PROJECT}::uuid`);
        await db.execute(sql`DELETE FROM event_rollup_minutes WHERE project_id = ${PROJECT}::uuid`);
        await db.execute(sql`
            INSERT INTO projects (id, organization_id, name, slug)
            VALUES (${PROJECT}::uuid, ${ORG_B}::uuid, 'Env Key', 'env-key')
            ON CONFLICT (id) DO NOTHING
        `);

        // production: 6 info + 2 error · staging: 3 error · no environment: 4 info.
        // Distinct counts, so a row attributed to the wrong environment changes
        // a number rather than cancelling out.
        const rows: Array<[string | null, string, number]> = [
            ["production", "info", 6],
            ["production", "error", 2],
            ["staging", "error", 3],
            [null, "info", 4],
        ];
        for (const [env, level, count] of rows) {
            for (let i = 0; i < count; i++) {
                await db.execute(sql`
                    INSERT INTO events (id, project_id, timestamp, level, message, environment)
                    VALUES (
                        gen_random_uuid(), ${PROJECT}::uuid,
                        ${anchor.toISOString()}::timestamptz + interval '1 minute',
                        ${level}, 'env key', ${env}
                    )
                `);
            }
        }

        envRange = { from: anchor, to: new Date(anchor.getTime() + 10 * 60_000) };

        await markRollupDirty(PROJECT, anchor);
        for (let i = 0; i < 5; i++) {
            const [state] = await db.execute<{ refresh_from: Date }>(sql`
                SELECT refresh_from FROM rollup_state WHERE project_id = ${PROJECT}::uuid
            `);
            if (!state) break;
            const result = await rebuildRollupForProject(PROJECT, new Date(state.refresh_from));
            if (!result.hasMore) break;
        }
    });

    it("writes one row per environment, with (unset) for events carrying none", async () => {
        const rows = await db.execute<{ environment: string; total: number }>(sql`
            SELECT environment, total FROM event_rollup_minutes
            WHERE project_id = ${PROJECT}::uuid
        `);

        // Sorted in JS, not in SQL. A database collation orders punctuation
        // differently — `ORDER BY environment` puts `(unset)` *after* the letters —
        // and `projectStats` documents the same trap for the same reason.
        const sorted = rows
            .map((r) => [r.environment, Number(r.total)] as [string, number])
            .sort((x, y) => (x[0] < y[0] ? -1 : 1));

        expect(sorted).toEqual([
            ["(unset)", 4],
            ["production", 8],
            ["staging", 3],
        ]);
    });

    it("answers a filtered level breakdown from the rollup", async () => {
        const rows = await levelBreakdown([PROJECT], envRange, ["production"]);

        // The joint question the marginals could not answer: 6 info + 2 error,
        // and none of staging's 3 errors.
        expect(Object.fromEntries(rows.map((r) => [r.level, r.count]))).toEqual({
            info: 6,
            error: 2,
        });
    });

    it("answers filtered per-project stats from the rollup", async () => {
        const stats = (await projectStats([PROJECT], envRange, ["staging"])).get(PROJECT);

        expect(stats?.totalEvents).toBe(3);
        expect(stats?.errorCount).toBe(3);
    });

    it("answers filtered buckets from the rollup", async () => {
        const buckets = await eventBucketsByLevel([PROJECT], envRange, 3600, ["production"]);

        expect(buckets).toHaveLength(1);
        expect(buckets[0].byLevel).toEqual({ info: 6, error: 2 });
    });

    /**
     * The pre-existing defect this work uncovered. `environmentsInUse` offers
     * `(unset)` as a pill, but `envCond` was a bare `environment = ANY(...)` and
     * SQL equality never matches NULL — so selecting that pill emptied every
     * widget and read as a quiet period.
     */
    it("matches events carrying no environment when (unset) is selected", async () => {
        const rows = await levelBreakdown([PROJECT], envRange, ["(unset)"]);

        expect(Object.fromEntries(rows.map((r) => [r.level, r.count]))).toEqual({ info: 4 });
    });

    it("sums to the unfiltered total across every environment", async () => {
        const all = await levelBreakdown([PROJECT], envRange);
        const parts = await Promise.all(
            [["production"], ["staging"], ["(unset)"]].map((e) =>
                levelBreakdown([PROJECT], envRange, e),
            ),
        );

        const total = (rows: Array<{ count: number }>) => rows.reduce((n, r) => n + r.count, 0);
        expect(parts.reduce((n, p) => n + total(p), 0)).toBe(total(all));
    });

    it("does not offer the reserved labels as environment pills", async () => {
        const envs = (await projectStats([PROJECT], envRange)).get(PROJECT)?.environments ?? [];

        expect(envs).toEqual(["production", "staging"]);
    });

});

/**
 * The safety net, against a minute that **actually folded**.
 *
 * An earlier version of this test fabricated an `(other)` row and asserted the
 * filtered read still gave the right answer. It passed with the floor check
 * disabled, because the fabricated row was not `production` and the filter
 * excluded it either way — a test whose name promised more than it measured,
 * the third of that shape found in this work.
 *
 * What bites is a minute where the environment being asked about is the one
 * that got folded. Six environments, `production` the quietest, cap five: the
 * rollup then has **no production row** for that minute, so a filtered read that
 * trusted it would report zero where raw `events` has one.
 */
describe("a folded minute is not used for a filtered read", () => {
    const PROJECT = "cccccccc-0000-4000-8000-00000000000c";
    let foldRange: { from: Date; to: Date };

    beforeAll(async () => {
        await db.execute(sql`DELETE FROM events WHERE project_id = ${PROJECT}::uuid`);
        await db.execute(sql`DELETE FROM rollup_state WHERE project_id = ${PROJECT}::uuid`);
        await db.execute(sql`DELETE FROM event_rollup_minutes WHERE project_id = ${PROJECT}::uuid`);
        await db.execute(sql`
            INSERT INTO projects (id, organization_id, name, slug)
            VALUES (${PROJECT}::uuid, ${ORG_B}::uuid, 'Folded', 'folded-env')
            ON CONFLICT (id) DO NOTHING
        `);

        // Five busy environments and `production` with a single event. Ranked by
        // count, production is sixth and lands in `(other)`.
        const busy = ["a", "b", "c", "d", "e"];
        for (const env of busy) {
            for (let i = 0; i < 3; i++) {
                await db.execute(sql`
                    INSERT INTO events (id, project_id, timestamp, level, message, environment)
                    VALUES (
                        gen_random_uuid(), ${PROJECT}::uuid,
                        ${anchor.toISOString()}::timestamptz + interval '1 minute',
                        'info', 'busy', ${env}
                    )
                `);
            }
        }
        await db.execute(sql`
            INSERT INTO events (id, project_id, timestamp, level, message, environment)
            VALUES (
                gen_random_uuid(), ${PROJECT}::uuid,
                ${anchor.toISOString()}::timestamptz + interval '1 minute',
                'info', 'quiet', 'production'
            )
        `);

        foldRange = { from: anchor, to: new Date(anchor.getTime() + 10 * 60_000) };

        await markRollupDirty(PROJECT, anchor);
        for (let i = 0; i < 5; i++) {
            const [state] = await db.execute<{ refresh_from: Date }>(sql`
                SELECT refresh_from FROM rollup_state WHERE project_id = ${PROJECT}::uuid
            `);
            if (!state) break;
            const result = await rebuildRollupForProject(PROJECT, new Date(state.refresh_from));
            if (!result.hasMore) break;
        }
    });

    it("really did fold production away — otherwise the test below proves nothing", async () => {
        const [row] = await db.execute<{ n: string }>(sql`
            SELECT COUNT(*)::text AS n FROM event_rollup_minutes
            WHERE project_id = ${PROJECT}::uuid AND environment = 'production'
        `);
        const [other] = await db.execute<{ n: string }>(sql`
            SELECT COUNT(*)::text AS n FROM event_rollup_minutes
            WHERE project_id = ${PROJECT}::uuid AND environment = '(other)'
        `);

        expect(Number(row.n)).toBe(0); // folded
        expect(Number(other.n)).toBe(1); // and the fold is recorded
    });

    it("reads the folded environment from events, not from the rollup", async () => {
        const rows = await levelBreakdown([PROJECT], foldRange, ["production"]);

        // One event. Trusting the rollup would report none at all.
        expect(Object.fromEntries(rows.map((r) => [r.level, r.count]))).toEqual({ info: 1 });
    });

    it("still totals correctly unfiltered, where the fold costs nothing", async () => {
        const rows = await levelBreakdown([PROJECT], foldRange);

        // 5 environments × 3 + production's 1. `(other)` is summed like any
        // other row when nothing is being filtered.
        expect(rows.find((r) => r.level === "info")?.count).toBe(16);
    });
});
