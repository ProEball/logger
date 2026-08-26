import { beforeAll, describe, expect, it } from "vitest";
import {
    eventBuckets,
    eventBucketsByLevel,
    eventsInLastMinute,
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
    ALPHA,
    BETA,
    COMMA_ENVIRONMENT,
    DASH,
    LONG_MESSAGE_GROUPED,
    canonicalRange,
    ORG_A_PROJECTS,
    QUIET,
} from "@/itest/support/fixture";
import { EVENT_LEVELS } from "@/shared/utils/event-filters.schema";
import { clickhouse } from "@/core/clickhouse/client";
import { uuidv7 } from "@/shared/utils/uuidv7";
import { fingerprintMessage } from "@/features/ingest/utils/normalize-message";
import { toClickhouseRow } from "@/features/ingest/utils/to-clickhouse-row";
import type { NewEvent } from "@/shared/types/event.types";
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
 * ## What Phase 4 removed from this file
 *
 * Four `describe` blocks and 513 lines, all of them about a summary table:
 * "rollup and raw tail", "topMessages — from the template rollup",
 * "environment as a rollup key", and "a folded minute is not used for a
 * filtered read". Each built a rollup for a project of its own, then asserted
 * that the read picked the right branch. There are no branches and no rollup;
 * every read below is one query over one table.
 *
 * The tests that remain are unchanged in what they assert. That is the point of
 * keeping them: the corpus and every expected number are the same, so a
 * difference between the Postgres answers and the ClickHouse ones shows up as a
 * failure here rather than as a number nobody recognises on a dashboard.
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
        // "(unset)" lands **first**, and this is a visible change from
        // Postgres. There, `ORDER BY environment` used the database collation,
        // which weights punctuation below letters, so the value sorted as if it
        // were "unset" and appeared at the end of the dropdown. ClickHouse
        // orders bytewise and `(` is 0x28, below every letter.
        //
        // Byte order is what this list was always supposed to have: the
        // Postgres version sorted its *other* environment list in TypeScript
        // precisely to escape the collation. The two are consistent now, and
        // the placeholder sits at the top of the dropdown rather than the
        // bottom.
        const envs = await environmentsInUse(ORG_A_PROJECTS);
        expect(envs).toEqual(["(unset)", "archive", COMMA_ENVIRONMENT, "production", "staging"]);
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
 * The reads Phase 4 either introduced or changed, against a **project of this
 * block's own**.
 *
 * Its own project because these tests write, and the shared corpus is
 * read-only: `fileParallelism` is on, so adding rows to a fixture project would
 * silently change what every other assertion in this file is measuring. The id
 * is minted per run, exactly as `clickhouse-ingest.service.itest.ts` does, so
 * two runs cannot collide in a table nothing truncates between them.
 */
describe("Phase 4 — what moved to ClickHouse", () => {
    const PROJECT = uuidv7();

    /** An enriched event, as ingest would have produced it. */
    function event(spec: Partial<NewEvent> & { message: string; at: Date }): NewEvent {
        const { at, ...patch } = spec;
        const fingerprint = fingerprintMessage(spec.message);
        return {
            id: uuidv7(),
            projectId: PROJECT,
            timestamp: at,
            level: "info",
            source: null,
            environment: null,
            release: null,
            userId: null,
            sessionId: null,
            requestId: null,
            traceId: null,
            errorType: null,
            stackTrace: null,
            attributes: {},
            context: {},
            userAgent: null,
            ip: null,
            templateHash: fingerprint.hash,
            messageTemplate: fingerprint.template,
            ...patch,
        };
    }

    /** Recent enough for `eventsInLastMinute`, which asks about the wall clock. */
    const justNow = () => new Date(Date.now() - 5_000);

    beforeAll(async () => {
        const rows: NewEvent[] = [
            // Three orders, one template. This is the Phase 4 grouping change:
            // under the Postgres raw path these were three rows of one.
            ...["o_1001", "o_1002", "o_1003"].map((id) =>
                event({ message: `order ${id} failed`, level: "error", at: justNow() }),
            ),
            // A message with no variable part, so its template is itself.
            event({ message: "cache warmed", at: justNow() }),
            // Outside the trailing minute, so `eventsInLastMinute` must not see
            // it while `eventBuckets` over a wide range must.
            event({ message: "cache warmed", at: new Date(Date.now() - 10 * 60_000) }),
        ];

        // `async_insert` is on the shared client, and it merges rows from
        // several concurrent queries into one block — which changes that
        // block's checksum and so breaks the deduplication assertion in
        // `clickhouse-ingest.service.itest.ts`, running in parallel against
        // this same table. A fixture write wants to be synchronous anyway.
        await clickhouse.insert({
            table: "events",
            values: rows.map(toClickhouseRow),
            format: "JSONEachRow",
            clickhouse_settings: { async_insert: 0 },
        });
    });

    /** A range wide enough to hold everything this block wrote. */
    const wide = () => ({ from: new Date(Date.now() - 60 * 60_000), to: new Date(Date.now() + 1000) });

    describe("topMessages groups by template", () => {
        it("collapses three different order ids into one row", async () => {
            const rows = await topMessages([PROJECT], wide());
            const orders = rows.find((r) => r.message.startsWith("order"));

            expect(orders).toBeDefined();
            expect(orders!.count).toBe(3);
        });

        it("labels the row with the template, not with any one event's text", async () => {
            // The visible half of the change, and the reason `message_template`
            // is stored per row: no query can derive `***` from SQL, so a row
            // written without it can only be labelled with a concrete instance.
            const rows = await topMessages([PROJECT], wide());

            expect(rows.map((r) => r.message).sort()).toEqual(["cache warmed", "order *** failed"]);
        });

        it("leaves a message with no variable part as itself", async () => {
            const rows = await topMessages([PROJECT], wide());
            const cache = rows.find((r) => r.message === "cache warmed");

            expect(cache?.count).toBe(2);
        });
    });

    describe("eventBuckets", () => {
        it("counts totals and errors per project across the range", async () => {
            // Five events, three of them errors. `eventBucketsByLevel` is
            // covered above; this is the cheaper sibling, which had no
            // integration coverage of its own before Phase 4.
            //
            // Summed over every bucket, not read off the first. Buckets are
            // floored to the **epoch** grid, so an hour-wide bucket splits
            // these rows in two whenever the clock is within ten minutes of an
            // hour boundary — which is exactly how this test failed once and
            // passed on every earlier run. A chart sums them too.
            const buckets = await eventBuckets([PROJECT], wide(), 3600);

            expect(buckets.every((b) => b.projectId === PROJECT)).toBe(true);
            expect(buckets.reduce((n, b) => n + b.total, 0)).toBe(5);
            expect(buckets.reduce((n, b) => n + b.errors, 0)).toBe(3);
        });

        it("returns nothing for a project with no events in the range", async () => {
            const past = { from: new Date(0), to: new Date(1000) };
            expect(await eventBuckets([PROJECT], past, 3600)).toEqual([]);
        });
    });

    describe("eventsInLastMinute", () => {
        /**
         * Never covered before Phase 4, in either store. It is the one read
         * whose window comes from the clock rather than from the page, which is
         * exactly why nothing in the fixture corpus — anchored two hours back —
         * could reach it.
         */
        it("counts only the trailing sixty seconds", async () => {
            expect(await eventsInLastMinute([PROJECT])).toBe(4);
        });

        it("returns zero for an empty project list without querying", async () => {
            expect(await eventsInLastMinute([])).toBe(0);
        });
    });

    describe("projectStats", () => {
        it("counts a project written after the fixture was seeded", async () => {
            const stats = await projectStats([PROJECT], wide());

            expect(stats.get(PROJECT)).toMatchObject({ totalEvents: 5, errorCount: 3 });
        });

        it("offers no environment pill for events that named none", async () => {
            const stats = await projectStats([PROJECT], wide());
            expect(stats.get(PROJECT)?.environments).toEqual([]);
        });
    });
});

/**
 * Which project a template is attributed to when several of them log it.
 *
 * The rule is "the project contributing the most events, ties broken toward the
 * smaller id", and it is one `argMin` over a tuple. It had **no coverage at
 * all** until Phase 4 — under Postgres it was a `ROW_NUMBER` window, and the
 * shared corpus gives every message to exactly one project, so nothing
 * exercised it. Found by mutation: replacing the tuple with a plain
 * `argMin(project_id, per_project)` — which picks the *least* busy project —
 * failed nothing.
 *
 * Two projects of its own, for the same reason as the block above.
 */
describe("topMessages — the owning project", () => {
    // **Which id is "smaller" is ClickHouse's question, not JavaScript's.**
    // ClickHouse compares a UUID as two UInt64 halves, so its ordering is not
    // the text ordering Postgres used — two ids that sort one way as strings
    // can sort the other way in the database. The tie test below therefore
    // asks the server which one it considers smaller rather than assuming.
    const [FIRST, SECOND] = [uuidv7(), uuidv7()];
    const SHARED = "shared *** template";

    function row(project: string, message: string): NewEvent {
        const fingerprint = fingerprintMessage(message);
        return {
            id: uuidv7(),
            projectId: project,
            timestamp: new Date(Date.now() - 30_000),
            level: "info",
            message,
            source: null,
            environment: null,
            release: null,
            userId: null,
            sessionId: null,
            requestId: null,
            traceId: null,
            errorType: null,
            stackTrace: null,
            attributes: {},
            context: {},
            userAgent: null,
            ip: null,
            templateHash: fingerprint.hash,
            messageTemplate: fingerprint.template,
        };
    }

    const wide = () => ({ from: new Date(Date.now() - 60 * 60_000), to: new Date(Date.now() + 1000) });

    beforeAll(async () => {
        await clickhouse.insert({
            table: "events",
            // Synchronous, for the reason given on the first fixture write above.
            clickhouse_settings: { async_insert: 0 },
            values: [
                // SECOND logs the shared template three times, FIRST once —
                // so the busier project wins despite having the larger id.
                ...["u_1", "u_2", "u_3"].map((u) => row(SECOND, `shared ${u} template`)),
                row(FIRST, "shared u_9 template"),
                // A second template both log exactly once, which is the tie.
                row(FIRST, "tied u_1 template"),
                row(SECOND, "tied u_2 template"),
            ].map(toClickhouseRow),
            format: "JSONEachRow",
        });
    });

    it("attributes a template to the project that logged it most", async () => {
        const rows = await topMessages([FIRST, SECOND], wide());
        const shared = rows.find((r) => r.message === SHARED);

        expect(shared).toMatchObject({ count: 4, projectId: SECOND });
    });

    /** Whichever of the two ClickHouse itself orders first. */
    async function smallerId(): Promise<string> {
        const result = await clickhouse.query({
            query: "SELECT min(project_id) AS id FROM events WHERE project_id IN {ids:Array(UUID)}",
            query_params: { ids: [FIRST, SECOND] },
            format: "JSONEachRow",
        });
        const [row] = await result.json<{ id: string }>();
        return row.id;
    }

    it("breaks a tie toward the id the database orders first", async () => {
        // Not cosmetic: without a deterministic tie-break the owning project
        // changes between two identical page loads and the widget's "which
        // project" column flickers.
        const rows = await topMessages([FIRST, SECOND], wide());
        const tied = rows.find((r) => r.message === "tied *** template");

        expect(tied).toMatchObject({ count: 2, projectId: await smallerId() });
    });

    it("resolves the same tie the same way twice", async () => {
        const owner = async () =>
            (await topMessages([FIRST, SECOND], wide())).find(
                (r) => r.message === "tied *** template",
            )?.projectId;

        expect(await owner()).toBe(await owner());
    });
});
