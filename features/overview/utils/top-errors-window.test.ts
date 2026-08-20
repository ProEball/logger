import { describe, it, expect } from "vitest";
import { OVERVIEW_PRESETS } from "@/features/overview/utils/overview-filters";
import {
    clampTopErrorsWindow,
    TOP_ERRORS_MAX_PRESET,
} from "@/features/overview/utils/top-errors-window";

describe("clampTopErrorsWindow", () => {
    it.each(["15m", "1h", "6h"] as const)("leaves %s alone — narrower than the cap", (preset) => {
        expect(clampTopErrorsWindow(preset)).toEqual({ preset, isClamped: false });
    });

    it("leaves the cap itself alone", () => {
        expect(clampTopErrorsWindow("24h")).toEqual({ preset: "24h", isClamped: false });
    });

    it.each(["7d", "30d"] as const)("clamps %s to the cap and says so", (preset) => {
        expect(clampTopErrorsWindow(preset)).toEqual({ preset: TOP_ERRORS_MAX_PRESET, isClamped: true });
    });

    it("never widens the window", () => {
        // Showing more than the page asked for would be surprising in the
        // other direction, and would defeat the point on a narrow range.
        for (const preset of OVERVIEW_PRESETS) {
            const result = clampTopErrorsWindow(preset);
            expect(OVERVIEW_PRESETS.indexOf(result.preset)).toBeLessThanOrEqual(
                OVERVIEW_PRESETS.indexOf(preset),
            );
        }
    });

    it("returns a preset the range resolver understands, for every input", () => {
        for (const preset of OVERVIEW_PRESETS) {
            expect(OVERVIEW_PRESETS).toContain(clampTopErrorsWindow(preset).preset);
        }
    });

    it("only reports isClamped when it actually narrowed something", () => {
        for (const preset of OVERVIEW_PRESETS) {
            const result = clampTopErrorsWindow(preset);
            expect(result.isClamped).toBe(result.preset !== preset);
        }
    });
});
