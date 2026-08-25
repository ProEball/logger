import { describe, it, expect } from "vitest";
import {
    emptyLevelledBucket,
    errorsIn,
    fillBuckets,
    hasEnvFilter,
    type LevelledBucket,
} from "./event-buckets";

/**
 * The pure half. The SQL that produces these buckets lives in
 * `shared/services/event-aggregations.service.ts` and is covered by its
 * `.itest.ts` against a real database — the query-builder mock cannot reach
 * `db.execute(sql...)`, and asserting on generated SQL text would test the
 * string rather than the answer (PROJECT.md §11).
 *
 * These functions sit in `utils/` rather than beside that service because
 * `OrgVolumeChart` is a client component and needs `errorsIn`: importing a
 * value from the service would pull `postgres` into the browser bundle.
 */

const HOUR = 3_600_000;
const T0 = new Date("2026-08-25T00:00:00.000Z");

function bucket(projectId: string, ts: Date, byLevel: Record<string, number>): LevelledBucket {
    return {
        projectId,
        ts,
        total: Object.values(byLevel).reduce((a, b) => a + b, 0),
        errors: (byLevel.error ?? 0) + (byLevel.fatal ?? 0),
        byLevel,
    };
}

describe("hasEnvFilter", () => {
    it("treats undefined and an empty list alike as unfiltered", () => {
        // Both must mean "no filter". An empty array taking the filtered branch
        // would produce `environment = ANY(ARRAY[])`, which matches nothing and
        // would silently empty every widget on the page.
        expect(hasEnvFilter(undefined)).toBe(false);
        expect(hasEnvFilter([])).toBe(false);
    });

    it("is filtered once a value is present", () => {
        expect(hasEnvFilter(["production"])).toBe(true);
    });
});

describe("errorsIn", () => {
    it("counts error and fatal together", () => {
        expect(errorsIn(bucket("p", T0, { info: 5, error: 3, fatal: 2 }))).toBe(5);
    });

    it("is zero when a bucket holds no errors", () => {
        expect(errorsIn(bucket("p", T0, { info: 5, warn: 1 }))).toBe(0);
        expect(errorsIn(bucket("p", T0, {}))).toBe(0);
    });

    it("counts fatal even with no plain errors", () => {
        // "Errors" on both dashboards means error *or* fatal. Reading only
        // `error` would show zero on a page whose project had just crashed.
        expect(errorsIn(bucket("p", T0, { fatal: 1 }))).toBe(1);
    });
});

describe("fillBuckets", () => {
    const range = { from: T0, to: new Date(T0.getTime() + 3 * HOUR) };

    it("returns one bucket per project per interval", () => {
        const filled = fillBuckets([], ["a", "b"], range, 3600, emptyLevelledBucket);
        expect(filled).toHaveLength(6);
    });

    it("keeps the real buckets and zero-fills only the gaps", () => {
        const real = bucket("a", new Date(T0.getTime() + HOUR), { info: 7 });
        const filled = fillBuckets([real], ["a"], range, 3600, emptyLevelledBucket);

        expect(filled.map((b) => b.total)).toEqual([0, 7, 0]);
    });

    /**
     * The case the org chart needs. A project with no events at all in the
     * range has no rows in the query result, so without filling it would have
     * no line — reading as "this project was deleted" rather than "this project
     * was quiet".
     */
    it("gives a project with no events a full flat series", () => {
        const filled = fillBuckets([bucket("a", T0, { info: 1 })], ["a", "quiet"], range, 3600, emptyLevelledBucket);
        const quiet = filled.filter((b) => b.projectId === "quiet");

        expect(quiet).toHaveLength(3);
        expect(quiet.every((b) => b.total === 0)).toBe(true);
    });

    it("does not mix one project's buckets into another's", () => {
        const filled = fillBuckets([bucket("a", T0, { info: 9 })], ["a", "b"], range, 3600, emptyLevelledBucket);

        expect(filled.find((x) => x.projectId === "b" && x.ts.getTime() === T0.getTime())?.total)
            .toBe(0);
    });

    /**
     * Boundaries are epoch-floored exactly as the SQL floors them, so a filled
     * timestamp lands on a real one. If these drifted, every real bucket would
     * be duplicated by a zero bucket one step away.
     */
    it("aligns filled timestamps to the bucket grid, not to `from`", () => {
        const offset = new Date(T0.getTime() + 17 * 60_000); // 00:17, mid-bucket
        const filled = fillBuckets([], ["a"], { from: offset, to: new Date(T0.getTime() + HOUR) }, 3600, emptyLevelledBucket);

        expect(filled).toHaveLength(1);
        expect(filled[0].ts.toISOString()).toBe(T0.toISOString());
    });

    /**
     * `to` is an exclusive bound. Including it would draw a trailing bucket for
     * a period the query never covered, which on a live chart reads as traffic
     * dropping to zero at the current instant.
     */
    it("excludes a bucket starting exactly at `to`", () => {
        const filled = fillBuckets([], ["a"], { from: T0, to: new Date(T0.getTime() + HOUR) }, 3600, emptyLevelledBucket);

        expect(filled).toHaveLength(1);
        expect(filled[0].ts.toISOString()).toBe(T0.toISOString());
    });

    it("handles a width that does not divide the range evenly", () => {
        // 3 hours at 45-minute buckets: 00:00, 00:45, 01:30, 02:15 — four.
        const filled = fillBuckets([], ["a"], range, 45 * 60, emptyLevelledBucket);
        expect(filled).toHaveLength(4);
    });
});
