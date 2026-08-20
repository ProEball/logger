import { beforeAll, describe, expect, it } from "vitest";
import {
    getOrgEnvironments,
    getOrgEventBuckets,
    getOrgLevelBreakdown,
    getOrgTopErrors,
    getProjectSummaries,
} from "@/features/overview/services/overview.service";
import {
    ALPHA,
    BETA,
    COMMA_ENVIRONMENT,
    canonicalRange,
    LONG_MESSAGE_GROUPED,
    ORG_A_PROJECTS,
    QUIET,
} from "@/itest/support/fixture";
import { readAnchor } from "@/itest/support/read-anchor";

/**
 * Integration tests for the five raw-SQL aggregations behind the org overview.
 *
 * Every expected number below is written as a literal with the arithmetic in a
 * comment, derived by hand from `itest/support/fixture.ts`. None of them is
 * computed from the corpus at runtime — computing it would mean
 * re-implementing the query in TypeScript and comparing the code with a copy
 * of itself.
 *
 * Corpus totals for the canonical one-hour range:
 *   Alpha 34 events (20 error/fatal) · Beta 17 (9) · Quiet 0 → 51 (29)
 * The other organization's 50 fatals sit outside every assertion here.
 */

let range: { from: Date; to: Date };
let anchor: Date;

beforeAll(async () => {
    anchor = await readAnchor();
    range = canonicalRange(anchor);
});

// ── getProjectSummaries ──────────────────────────────────────────────────────

describe("getProjectSummaries", () => {
    it("returns an empty map for no projects without querying", async () => {
        expect(await getProjectSummaries([], range)).toEqual(new Map());
    });

    it("counts every event in the range per project", async () => {
        const map = await getProjectSummaries(ORG_A_PROJECTS, range);
        expect(map.get(ALPHA)?.totalEvents).toBe(34); // 1+12+10+1+1+2+2+3+2
        expect(map.get(BETA)?.totalEvents).toBe(17); // 9+6+2
    });

    it("counts fatal as an error", async () => {
        const map = await getProjectSummaries(ORG_A_PROJECTS, range);
        expect(map.get(ALPHA)?.errorCount).toBe(20); // 10 boom +1 fatal +2+2 long +3+2 rare
        expect(map.get(BETA)?.errorCount).toBe(9);
    });

    it("omits a project with no events entirely, rather than returning zeros", async () => {
        // The caller (`buildProjectRows`) is what turns a missing entry into a
        // zeroed row; the service itself simply has no row to return.
        const map = await getProjectSummaries(ORG_A_PROJECTS, range);
        expect(map.has(QUIET)).toBe(false);
    });

    it("excludes an event sitting exactly on the exclusive upper bound", async () => {
        // "alpha at upper bound" is at anchor+60m, which is `to`.
        const map = await getProjectSummaries(ORG_A_PROJECTS, range);
        expect(map.get(ALPHA)?.totalEvents).toBe(34);

        const wider = { from: range.from, to: new Date(range.to.getTime() + 1) };
        expect((await getProjectSummaries(ORG_A_PROJECTS, wider)).get(ALPHA)?.totalEvents).toBe(35);
    });

    it("includes an event sitting exactly on the inclusive lower bound", async () => {
        const later = { from: new Date(range.from.getTime() + 1), to: range.to };
        // Losing only the anchor marker itself.
        expect((await getProjectSummaries(ORG_A_PROJECTS, later)).get(ALPHA)?.totalEvents).toBe(33);
    });

    it("never counts events belonging to another organization", async () => {
        // The other org has 50 fatals in this range. Asking for org A's
        // projects must not see them under any aggregate.
        const map = await getProjectSummaries(ORG_A_PROJECTS, range);
        const total = [...map.values()].reduce((s, r) => s + r.totalEvents, 0);
        expect(total).toBe(51); // 34 + 17, not 101
    });

    it("reports the most frequent error message per project", async () => {
        const map = await getProjectSummaries(ORG_A_PROJECTS, range);
        expect(map.get(ALPHA)?.topMessage).toBe("alpha boom"); // 10, the most of any
        expect(map.get(ALPHA)?.topMessageLevel).toBe("error");
        expect(map.get(BETA)?.topMessage).toBe("beta boom");
    });

    it("lists a project's environments, excluding NULL", async () => {
        const map = await getProjectSummaries(ORG_A_PROJECTS, range);
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
        const map = await getProjectSummaries(ORG_A_PROJECTS, range);
        const envs = map.get(ALPHA)?.environments ?? [];

        expect(envs).toEqual([COMMA_ENVIRONMENT, "production", "staging"]);
        expect(envs).not.toContain("eu");
    });

    it("applies a level filter to the event counts", async () => {
        const map = await getProjectSummaries(ORG_A_PROJECTS, range, ["info"]);
        expect(map.get(ALPHA)?.totalEvents).toBe(14); // marker 1 + routine 12 + comma-env 1
        expect(map.get(BETA)?.totalEvents).toBe(6);
        expect(map.get(ALPHA)?.errorCount).toBe(0);
    });

    it("KNOWN BUG: a level filter does not reach the top-message query", async () => {
        // The stats query takes the filter; the top-message query is hardcoded
        // to `level IN ('error','fatal')` (overview.service.ts:101). Filtering
        // to `info` therefore yields a project with zero errors and an error
        // message attached. `getOrgTopErrors`, on the same page under the same
        // filter, does respect it — so the two widgets disagree.
        //
        // Which behaviour is correct is a product question, so this pins the
        // current one. The e2e suite pins the visible half of the same bug.
        const map = await getProjectSummaries(ORG_A_PROJECTS, range, ["info"]);
        expect(map.get(ALPHA)?.errorCount).toBe(0);
        expect(map.get(ALPHA)?.topMessage).toBe("alpha boom");
    });

    it("applies an environment filter to the event counts", async () => {
        const map = await getProjectSummaries(ORG_A_PROJECTS, range, undefined, ["production"]);
        expect(map.get(ALPHA)?.totalEvents).toBe(32); // 34 less the staging fatal and the comma env
        // Beta has nothing in production at all.
        expect(map.has(BETA)).toBe(false);
    });

    it("returns nothing for a range that contains no events", async () => {
        const quiet = {
            from: new Date(anchor.getTime() - 3 * 60 * 60_000),
            to: new Date(anchor.getTime() - 2 * 60 * 60_000),
        };
        expect((await getProjectSummaries(ORG_A_PROJECTS, quiet)).size).toBe(0);
    });
});

// ── getOrgLevelBreakdown ─────────────────────────────────────────────────────

describe("getOrgLevelBreakdown", () => {
    it("returns nothing for no projects", async () => {
        expect(await getOrgLevelBreakdown([], range)).toEqual([]);
    });

    it("counts every level present, and only those", async () => {
        const rows = await getOrgLevelBreakdown(ORG_A_PROJECTS, range);
        expect(Object.fromEntries(rows.map((r) => [r.level, r.count]))).toEqual({
            error: 28, // 10 + 2 + 2 + 3 + 2 alpha, 9 beta
            info: 20, //  1 + 12 + 1 alpha, 6 beta
            warn: 2,
            fatal: 1,
        });
        // `debug` never occurs in the corpus and must not appear as a zero.
        expect(rows.map((r) => r.level)).not.toContain("debug");
    });

    it("orders by count numerically, not by the text of the count", async () => {
        // Regression guard for the 2026-08-20 fix: `COUNT(*)::text AS count`
        // with `ORDER BY count DESC` binds to the text alias, which ranks
        // "2" above "28" and "9" above "10".
        const rows = await getOrgLevelBreakdown(ORG_A_PROJECTS, range);
        expect(rows.map((r) => r.level)).toEqual(["error", "info", "warn", "fatal"]);
        expect(rows.map((r) => r.count)).toEqual([28, 20, 2, 1]);
    });

    it("applies an environment filter", async () => {
        const rows = await getOrgLevelBreakdown(ORG_A_PROJECTS, range, ["staging"]);
        expect(rows).toEqual([
            { level: "error", count: 9 }, // beta boom
            { level: "fatal", count: 1 }, // alpha meltdown
        ]);
    });
});

// ── getOrgTopErrors ──────────────────────────────────────────────────────────

describe("getOrgTopErrors", () => {
    it("returns nothing for no projects", async () => {
        expect(await getOrgTopErrors([], range)).toEqual([]);
    });

    it("orders by count numerically, not by the text of the count", async () => {
        // 10 against 9 is the pair that separates the two orderings. This is
        // the bug e2e/overview.spec.ts found on its first run.
        const rows = await getOrgTopErrors(ORG_A_PROJECTS, range);
        expect(rows[0].message).toBe("alpha boom");
        expect(rows[0].count).toBe(10);
        expect(rows[1].message).toBe("beta boom");
        expect(rows[1].count).toBe(9);
    });

    it("groups messages that are identical through their first 200 characters", async () => {
        const rows = await getOrgTopErrors(ORG_A_PROJECTS, range);
        const grouped = rows.find((r) => r.message.startsWith("LLL"));
        expect(grouped?.count).toBe(4); // 2 + 2, from two different full messages
        expect(grouped?.message).toBe(LONG_MESSAGE_GROUPED);
        expect(grouped?.message).toHaveLength(200);
    });

    it("honours the limit, dropping the smallest groups", async () => {
        // Six distinct groups exist: 10, 9, 4, 3, 2, 1.
        const rows = await getOrgTopErrors(ORG_A_PROJECTS, range);
        expect(rows).toHaveLength(5);
        expect(rows.map((r) => r.count)).toEqual([10, 9, 4, 3, 2]);
        expect(rows.map((r) => r.message)).not.toContain("alpha meltdown");
    });

    it("returns every group when the limit is raised above their number", async () => {
        const rows = await getOrgTopErrors(ORG_A_PROJECTS, range, undefined, undefined, 50);
        expect(rows).toHaveLength(6);
        expect(rows.at(-1)?.message).toBe("alpha meltdown");
    });

    it("defaults to error and fatal only", async () => {
        const rows = await getOrgTopErrors(ORG_A_PROJECTS, range, undefined, undefined, 50);
        const messages = rows.map((r) => r.message);
        expect(messages).not.toContain("alpha routine");
        expect(messages).not.toContain("beta warning");
        expect(messages).toContain("alpha meltdown"); // fatal is included
    });

    it("an explicit level list overrides that default", async () => {
        const rows = await getOrgTopErrors(ORG_A_PROJECTS, range, ["warn"]);
        expect(rows).toEqual([
            expect.objectContaining({ message: "beta warning", count: 2 }),
        ]);
    });

    it("attributes a group to its project", async () => {
        const rows = await getOrgTopErrors(ORG_A_PROJECTS, range);
        expect(rows[0].projectId).toBe(ALPHA);
        expect(rows[1].projectId).toBe(BETA);
    });

    it("reports the most recent occurrence in the group", async () => {
        const rows = await getOrgTopErrors(ORG_A_PROJECTS, range);
        // Every "alpha boom" is at anchor+5m.
        expect(rows[0].latestAt.getTime()).toBe(anchor.getTime() + 5 * 60_000);
    });

    it("never returns another organization's errors", async () => {
        const rows = await getOrgTopErrors(ORG_A_PROJECTS, range, undefined, undefined, 50);
        expect(rows.map((r) => r.message)).not.toContain("other org noise");
    });
});

// ── getOrgEnvironments ───────────────────────────────────────────────────────

describe("getOrgEnvironments", () => {
    it("returns nothing for no projects", async () => {
        expect(await getOrgEnvironments([])).toEqual([]);
    });

    it("labels a NULL environment and sorts the list", async () => {
        // "(unset)" lands last, not first: `ORDER BY environment` uses the
        // database collation, which weights punctuation below letters, so the
        // value sorts as if it were "unset". Under a plain ASCII ordering the
        // parenthesis would have put it first. The UI shows the list in this
        // order, so the placeholder appears at the end of the dropdown.
        const envs = await getOrgEnvironments(ORG_A_PROJECTS);
        expect(envs).toEqual(["archive", COMMA_ENVIRONMENT, "production", "staging", "(unset)"]);
    });

    it("looks back exactly 30 days regardless of the page's selected range", async () => {
        // "archive" is 20 days old and appears; "legacy" is 40 days old and
        // does not — even though the function takes no range argument at all,
        // which is the point: the dropdown ignores the filter bar above it and
        // scans 30 days on every page load. Recorded as a Stage D target.
        const envs = await getOrgEnvironments(ORG_A_PROJECTS);
        expect(envs).toContain("archive");
        expect(envs).not.toContain("legacy");
    });
});

// ── getOrgEventBuckets ───────────────────────────────────────────────────────

describe("getOrgEventBuckets", () => {
    it("returns nothing for no projects", async () => {
        expect(await getOrgEventBuckets([], range)).toEqual([]);
    });

    it("buckets each project separately", async () => {
        const rows = await getOrgEventBuckets(ORG_A_PROJECTS, range, 3600);
        expect(rows).toHaveLength(2); // alpha and beta; quiet has no row
        const byProject = Object.fromEntries(rows.map((r) => [r.projectId, r]));
        expect(byProject[ALPHA].count).toBe(34);
        expect(byProject[ALPHA].errorCount).toBe(20);
        expect(byProject[BETA].count).toBe(17);
        expect(byProject[BETA].errorCount).toBe(9);
    });

    it("aligns bucket boundaries to the bucket width", async () => {
        const rows = await getOrgEventBuckets(ORG_A_PROJECTS, range, 3600);
        // The anchor is an exact hour boundary, so the bucket starts on it.
        for (const row of rows) {
            expect(row.ts.getTime()).toBe(anchor.getTime());
            expect(row.ts.getTime() % 3_600_000).toBe(0);
        }
    });

    it("splits a range into several buckets", async () => {
        const twoHours = { from: anchor, to: new Date(anchor.getTime() + 120 * 60_000) };
        const rows = await getOrgEventBuckets(ORG_A_PROJECTS, twoHours, 3600);

        // Alpha in both hours (34, then the upper-bound event plus 3 warns);
        // Beta only in the first.
        expect(rows).toHaveLength(3);
        const second = rows.filter((r) => r.ts.getTime() === anchor.getTime() + 3_600_000);
        expect(second).toHaveLength(1);
        expect(second[0].projectId).toBe(ALPHA);
        expect(second[0].count).toBe(4); // 1 at upper bound + 3 "alpha later"
    });

    it("leaves an empty bucket out rather than filling it with a zero", async () => {
        // Unlike the project dashboard, the org chart has no fillBuckets()
        // equivalent — a quiet bucket is simply absent from the result.
        const threeHours = { from: anchor, to: new Date(anchor.getTime() + 180 * 60_000) };
        const rows = await getOrgEventBuckets(ORG_A_PROJECTS, threeHours, 3600);
        const third = rows.filter((r) => r.ts.getTime() === anchor.getTime() + 2 * 3_600_000);
        expect(third).toEqual([]);
    });

    it("returns rows ordered oldest first", async () => {
        const twoHours = { from: anchor, to: new Date(anchor.getTime() + 120 * 60_000) };
        const rows = await getOrgEventBuckets(ORG_A_PROJECTS, twoHours, 3600);
        const times = rows.map((r) => r.ts.getTime());
        expect(times).toEqual([...times].sort((a, b) => a - b));
    });

    it("ignores the level and environment filters, which it does not accept", async () => {
        // Documented so the asymmetry is deliberate rather than surprising:
        // the volume chart always plots every event in the range, while every
        // other widget on the page narrows. Changing that is a product call.
        const rows = await getOrgEventBuckets(ORG_A_PROJECTS, range, 3600);
        const total = rows.reduce((s, r) => s + r.count, 0);
        expect(total).toBe(51);
    });
});
