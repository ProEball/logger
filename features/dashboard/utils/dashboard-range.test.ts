import { describe, it, expect } from "vitest";
import {
    DASHBOARD_PRESETS,
    DASHBOARD_SEGMENT_PRESETS,
    DEFAULT_DASHBOARD_PRESET,
    dashboardRangePreset,
    parseDashboardRange,
} from "./dashboard-range";
import { TIME_RANGE_PRESETS } from "@/shared/utils/event-filters.schema";

describe("DASHBOARD_PRESETS", () => {
    /**
     * The property this module exists for. Before 2026-08-21 there were three
     * separate lists — this one, the shared schema's, and a hardcoded `Set` in
     * the route — agreeing only by coincidence. Deriving rather than restating
     * is what makes them unable to drift; this asserts the derivation, not the
     * contents, so adding a preset to the schema does not break it.
     */
    it("is the shared schema's list, not a copy of it", () => {
        expect(DASHBOARD_PRESETS).toEqual(TIME_RANGE_PRESETS);
    });

    it("offers a default that is itself a valid preset", () => {
        expect(DASHBOARD_PRESETS).toContain(DEFAULT_DASHBOARD_PRESET);
    });
});

describe("DASHBOARD_SEGMENT_PRESETS", () => {
    /**
     * The header shows a subset — six buttons do not fit — but every button it
     * shows must be a value `parseDashboardRange` accepts. A button the parser
     * rejects would silently reset the page to 1h when clicked.
     *
     * This is the assertion that was missing on 2026-08-21: the list had been
     * a free-standing literal in the header, unconnected to the module written
     * to stop preset lists drifting.
     */
    it("offers only presets the parser accepts", () => {
        for (const preset of DASHBOARD_SEGMENT_PRESETS) {
            expect(parseDashboardRange(preset)).toEqual({ type: "preset", value: preset });
        }
    });

    it("is a strict subset — the full list is elsewhere", () => {
        expect(DASHBOARD_SEGMENT_PRESETS.length).toBeLessThan(DASHBOARD_PRESETS.length);
        for (const preset of DASHBOARD_SEGMENT_PRESETS) {
            expect(DASHBOARD_PRESETS).toContain(preset);
        }
    });
});

describe("parseDashboardRange", () => {
    it.each(TIME_RANGE_PRESETS)("accepts the preset %s", (preset) => {
        expect(parseDashboardRange(preset)).toEqual({ type: "preset", value: preset });
    });

    it.each([
        ["an absent param", undefined],
        ["a null param, as URLSearchParams.get returns", null],
        ["an unknown preset", "42h"],
        ["an empty string", ""],
        ["a resolved date, which is not a preset", "2026-08-21T00:00:00Z"],
    ])("falls back to the default for %s", (_label, raw) => {
        expect(parseDashboardRange(raw)).toEqual({
            type: "preset",
            value: DEFAULT_DASHBOARD_PRESET,
        });
    });

    /**
     * A repeated `?range=1h&range=7d` arrives as an array. Dropped rather than
     * guessed at — the range picker only ever emits the single-value form, so
     * an array means something else built the URL.
     */
    it("drops a repeated param rather than picking one", () => {
        expect(parseDashboardRange(["1h", "7d"])).toEqual({
            type: "preset",
            value: DEFAULT_DASHBOARD_PRESET,
        });
    });

    it("never returns a custom range", () => {
        // Nothing reachable from a URL produces one, and the cache key depends
        // on that: a resolved date range is unique to the millisecond.
        for (const raw of ["1h", "nonsense", "", undefined, null, ["a", "b"]]) {
            expect(parseDashboardRange(raw).type).toBe("preset");
        }
    });
});

describe("dashboardRangePreset", () => {
    it("names the preset of a preset range", () => {
        expect(dashboardRangePreset({ type: "preset", value: "7d" })).toBe("7d");
    });

    it("is null for a custom range, so a caller cannot key a cache on one", () => {
        expect(
            dashboardRangePreset({
                type: "custom",
                from: "2026-08-20T00:00:00Z",
                to: "2026-08-21T00:00:00Z",
            }),
        ).toBeNull();
    });
});
