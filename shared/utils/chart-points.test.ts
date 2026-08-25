import { describe, it, expect } from "vitest";
import {
    activeLevels,
    errorRatioPoints,
    levelPoints,
    projectSeries,
} from "./chart-points";
import type { EventBucket, LevelledBucket } from "./event-buckets";

/**
 * This arithmetic was unreachable by any test until 2026-08-25: it lived inside
 * two client components, each with its own copy. These are the first assertions
 * ever made about what either chart plots.
 */

const T0 = new Date("2026-08-25T00:00:00.000Z");
const T1 = new Date("2026-08-25T01:00:00.000Z");

function b(projectId: string, ts: Date, total: number, errors: number): EventBucket {
    return { projectId, ts, total, errors };
}

function lb(ts: Date, byLevel: Record<string, number>): LevelledBucket {
    return {
        projectId: "p",
        ts,
        total: Object.values(byLevel).reduce((a, n) => a + n, 0),
        errors: (byLevel.error ?? 0) + (byLevel.fatal ?? 0),
        byLevel,
    };
}

const PROJECTS = [
    { id: "a", name: "Alpha" },
    { id: "b", name: "Beta" },
];

describe("errorRatioPoints", () => {
    it("plots the percentage of events that were errors", () => {
        const points = errorRatioPoints([b("a", T0, 200, 50)], PROJECTS);

        expect(points[0].a).toBe(25);
    });

    /**
     * The reason it is a ratio and not a count. Alpha has ten times the traffic
     * and a tenth of the error rate; on a count axis it would tower over Beta
     * while being the healthier of the two.
     */
    it("does not let a busy project outrank a broken one", () => {
        const points = errorRatioPoints([b("a", T0, 1000, 10), b("b", T0, 100, 50)], PROJECTS);

        expect(points[0].a).toBe(1);
        expect(points[0].b).toBe(50);
    });

    /**
     * `0/0` is not a ratio. Plotting a gap instead would read as missing data
     * on a line chart, which is a different claim from "nothing happened".
     */
    it("plots zero for a bucket with no events, not a gap", () => {
        const points = errorRatioPoints([b("a", T0, 0, 0)], PROJECTS);

        expect(points[0].a).toBe(0);
    });

    it("gives every project a value in every bucket it asked about", () => {
        // Beta had no events at T0, so the query returned no row for it. The
        // line must still be drawn, or it would appear to start late.
        const points = errorRatioPoints([b("a", T0, 10, 1)], PROJECTS);

        expect(points[0].b).toBe(0);
    });

    it("orders buckets oldest first regardless of input order", () => {
        const points = errorRatioPoints([b("a", T1, 10, 1), b("a", T0, 10, 5)], PROJECTS);

        expect(points.map((p) => p.ts)).toEqual([T0.toISOString(), T1.toISOString()]);
    });

    it("rounds to two decimals, so the tooltip is not a float smear", () => {
        // 1/3 of 100 is 33.333…; the chart shows one decimal and the tooltip two.
        const points = errorRatioPoints([b("a", T0, 3, 1)], PROJECTS);

        expect(points[0].a).toBe(33.33);
    });

    it("returns nothing for no buckets", () => {
        expect(errorRatioPoints([], PROJECTS)).toEqual([]);
    });
});

describe("projectSeries", () => {
    it("labels each series with the project name and keys it by id", () => {
        expect(projectSeries(PROJECTS).map((s) => [s.key, s.label])).toEqual([
            ["a", "Alpha"],
            ["b", "Beta"],
        ]);
    });

    it("gives every project a colour, cycling past the palette's length", () => {
        const many = Array.from({ length: 9 }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
        const colors = projectSeries(many).map((s) => s.color);

        expect(colors.every(Boolean)).toBe(true);
        // Seven colours, nine projects: the eighth reuses the first.
        expect(colors[7]).toBe(colors[0]);
    });
});

describe("levelPoints", () => {
    const LEVELS = ["debug", "info", "warn", "error", "fatal"] as const;

    it("puts one number per level on each point", () => {
        const points = levelPoints([lb(T0, { info: 5, error: 2 })], LEVELS);

        expect(points[0]).toEqual({
            ts: T0.toISOString(),
            debug: 0,
            info: 5,
            warn: 0,
            error: 2,
            fatal: 0,
        });
    });

    it("orders buckets oldest first", () => {
        const points = levelPoints([lb(T1, { info: 1 }), lb(T0, { info: 2 })], LEVELS);

        expect(points.map((p) => p.ts)).toEqual([T0.toISOString(), T1.toISOString()]);
    });

    it("does not mutate the caller's array", () => {
        const input = [lb(T1, { info: 1 }), lb(T0, { info: 2 })];
        levelPoints(input, LEVELS);

        expect(input[0].ts).toBe(T1);
    });
});

describe("activeLevels", () => {
    const LEVELS = ["debug", "info", "warn", "error", "fatal"] as const;

    /**
     * A legend listing five levels for a project that logs two is noise, and an
     * all-zero area still draws a line along the axis that reads as data.
     */
    it("keeps only levels that actually occur", () => {
        expect(activeLevels([lb(T0, { info: 5, error: 2 })], LEVELS)).toEqual(["info", "error"]);
    });

    it("preserves the given order rather than the order encountered", () => {
        // Severity order is what the legend reads in; input order is arbitrary.
        expect(activeLevels([lb(T0, { error: 1, debug: 1 })], LEVELS)).toEqual(["debug", "error"]);
    });

    it("treats a level present only as zero as absent", () => {
        expect(activeLevels([lb(T0, { info: 3, warn: 0 })], LEVELS)).toEqual(["info"]);
    });

    it("is empty for no buckets", () => {
        expect(activeLevels([], LEVELS)).toEqual([]);
    });
});
