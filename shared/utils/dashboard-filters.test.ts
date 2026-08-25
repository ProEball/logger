import { describe, it, expect } from "vitest";
import {
    BUCKET_SECONDS,
    DASHBOARD_PRESETS,
    DEFAULT_PRESET,
    bucketSecondsFor,
    parseDashboardFilters,
    parseRange,
    parseRangePreset,
    presetMinutes,
    resolveRange,
} from "./dashboard-filters";
import { TIME_RANGE_PRESETS } from "./event-filters.schema";

describe("parseRangePreset", () => {
    it("accepts every preset the schema defines", () => {
        for (const preset of TIME_RANGE_PRESETS) {
            expect(parseRangePreset(preset)).toBe(preset);
        }
    });

    it("falls back to the default when the param is absent", () => {
        expect(parseRangePreset(undefined)).toBe(DEFAULT_PRESET);
        expect(parseRangePreset(null)).toBe(DEFAULT_PRESET);
    });

    it("falls back to the default for an unrecognised value", () => {
        expect(parseRangePreset("42h")).toBe(DEFAULT_PRESET);
        expect(parseRangePreset("")).toBe(DEFAULT_PRESET);
    });

    it("rejects a preset differing only in case", () => {
        // The lookup is a Set of exact strings. Asserted rather than assumed:
        // accepting "1H" would mean two spellings of one range reaching the
        // cache as two keys, halving the hit rate for no user-visible reason.
        expect(parseRangePreset("1H")).toBe(DEFAULT_PRESET);
        expect(parseRangePreset("30D")).toBe(DEFAULT_PRESET);
    });

    /**
     * A repeated param arrives as an array. Guessing which of `?range=1h&range=7d`
     * was meant is worse than showing the default, which is at least a range the
     * user can see is selected.
     */
    it("drops a repeated param rather than guessing which value was meant", () => {
        expect(parseRangePreset(["1h", "7d"])).toBe(DEFAULT_PRESET);
    });

    it("is the single source of what a valid preset is", () => {
        // Not a second list: the presets are derived from the schema, which is
        // what stops a preset being added in one place and rejected in another.
        expect([...DASHBOARD_PRESETS]).toEqual([...TIME_RANGE_PRESETS]);
    });

    it("offers a default that is itself a valid preset", () => {
        // A default the parser would reject makes every malformed URL loop
        // through a value nothing can render.
        expect(DASHBOARD_PRESETS).toContain(DEFAULT_PRESET);
    });

    /**
     * Both filter bars render this list directly, so every value in it must be
     * one the parser accepts — a button the parser rejects silently resets the
     * page to the default when clicked.
     *
     * It replaced `DASHBOARD_SEGMENT_PRESETS`, a four-preset subset the project
     * dashboard's header showed because six buttons were said not to fit. The
     * org overview has shown all six in the same bar height since it was built,
     * so the constraint was not real; the subset was the fourth preset list in
     * the codebase, and the assertion that it stayed a subset was the only thing
     * keeping it honest.
     */
    it("is renderable as-is: every entry round-trips through the parser", () => {
        for (const preset of DASHBOARD_PRESETS) {
            expect(parseRange(preset)).toEqual({ type: "preset", value: preset });
        }
    });
});

describe("parseRange", () => {
    it("returns the preset shape the services take", () => {
        expect(parseRange("7d")).toEqual({ type: "preset", value: "7d" });
    });

    it("degrades to the default range, not to an invalid one", () => {
        expect(parseRange("nonsense")).toEqual({ type: "preset", value: DEFAULT_PRESET });
    });
});

describe("bucketSecondsFor", () => {
    it("covers every preset at both densities", () => {
        // A missing cell would return undefined and reach SQL as NaN — the kind
        // of gap a Record type cannot catch once a preset is added to the enum.
        for (const preset of TIME_RANGE_PRESETS) {
            expect(bucketSecondsFor(preset, "fine")).toBeGreaterThan(0);
            expect(bucketSecondsFor(preset, "coarse")).toBeGreaterThan(0);
        }
    });

    /**
     * The live-tail case, and the only cell where the two densities disagree.
     * If this stops being the only difference, the `BucketDensity` doc is wrong.
     */
    it("differs between densities at 1h and nowhere else", () => {
        const differing = TIME_RANGE_PRESETS.filter(
            (p) => BUCKET_SECONDS.fine[p] !== BUCKET_SECONDS.coarse[p],
        );
        expect(differing).toEqual(["1h"]);
    });

    it("gives the project dashboard a minute-grained hour", () => {
        expect(bucketSecondsFor("1h", "fine")).toBe(60);
        expect(60 * 60 / bucketSecondsFor("1h", "fine")).toBe(60);
    });

    /**
     * The defect this table replaced. `pickBucket()` chose from four widths by
     * range length, and 6 hours landed on the 1-hour width — six marks to
     * describe six hours, against twenty-four on the overview for the same
     * window. Every cell is now inside a readable band.
     */
    it("keeps every chart between 12 and 60 points", () => {
        const spans = { "15m": 15, "1h": 60, "6h": 360, "24h": 1440, "7d": 10080, "30d": 43200 };
        for (const density of ["fine", "coarse"] as const) {
            for (const preset of TIME_RANGE_PRESETS) {
                const points = (spans[preset] * 60) / bucketSecondsFor(preset, density);
                expect(
                    points,
                    `${preset} at ${density} density draws ${points} points`,
                ).toBeGreaterThanOrEqual(12);
                expect(points).toBeLessThanOrEqual(60);
            }
        }
    });

    it("uses whole minutes, so buckets line up with the rollup's grain", () => {
        // The rollup stores one row per minute. A width that is not a multiple
        // of 60 could not be summed out of it without splitting a stored row.
        for (const density of ["fine", "coarse"] as const) {
            for (const preset of TIME_RANGE_PRESETS) {
                expect(bucketSecondsFor(preset, density) % 60).toBe(0);
            }
        }
    });
});

describe("resolveRange", () => {
    it("resolves a preset backwards from now", () => {
        const before = Date.now();
        const { from, to } = resolveRange({ type: "preset", value: "1h" });
        const after = Date.now();

        expect(to.getTime()).toBeGreaterThanOrEqual(before);
        expect(to.getTime()).toBeLessThanOrEqual(after);
        expect(to.getTime() - from.getTime()).toBe(60 * 60_000);
    });

    it("spans exactly the preset's length for every preset", () => {
        for (const preset of TIME_RANGE_PRESETS) {
            const { from, to } = resolveRange({ type: "preset", value: preset });
            expect((to.getTime() - from.getTime()) / 60_000).toBe(presetMinutes(preset));
        }
    });

    it("passes a custom range through as given", () => {
        const range = resolveRange({
            type: "custom",
            from: "2026-08-01T00:00:00.000Z",
            to: "2026-08-02T00:00:00.000Z",
        });
        expect(range.from.toISOString()).toBe("2026-08-01T00:00:00.000Z");
        expect(range.to.toISOString()).toBe("2026-08-02T00:00:00.000Z");
    });
});

describe("parseDashboardFilters", () => {
    it("defaults everything when the URL is empty", () => {
        expect(parseDashboardFilters({}, "coarse")).toEqual({
            preset: DEFAULT_PRESET,
            range: { type: "preset", value: DEFAULT_PRESET },
            bucketSecs: bucketSecondsFor(DEFAULT_PRESET, "coarse"),
            environment: "",
            environmentsFilter: undefined,
        });
    });

    it("reads range and environment together", () => {
        const filters = parseDashboardFilters({ range: "24h", env: "production" }, "fine");
        expect(filters.preset).toBe("24h");
        expect(filters.environment).toBe("production");
        expect(filters.environmentsFilter).toEqual(["production"]);
    });

    /**
     * `undefined` rather than `[]`. The services read "no filter" from
     * `undefined`; an empty array would take the filtered branch and match
     * nothing, emptying every widget on the page.
     */
    it("reports an absent environment as undefined, not an empty array", () => {
        expect(parseDashboardFilters({ range: "1h" }, "fine").environmentsFilter).toBeUndefined();
        expect(parseDashboardFilters({ env: "" }, "fine").environmentsFilter).toBeUndefined();
    });

    it("ignores a repeated env param", () => {
        expect(parseDashboardFilters({ env: ["a", "b"] }, "fine").environmentsFilter)
            .toBeUndefined();
    });

    it("takes the bucket width from the density it was asked for", () => {
        expect(parseDashboardFilters({ range: "1h" }, "fine").bucketSecs).toBe(60);
        expect(parseDashboardFilters({ range: "1h" }, "coarse").bucketSecs).toBe(300);
    });
});
