import { describe, it, expect } from "vitest";
import {
    DEFAULT_PREFERENCES,
    parseAutoRefresh,
    parsePreferences,
    splitAutoRefresh,
} from "@/shared/types/user-preferences.types";

describe("parseAutoRefresh", () => {
    it.each(["off", "30s", "60s", "5m"] as const)("accepts the supported value %s", (value) => {
        expect(parseAutoRefresh(value)).toBe(value);
    });

    it("translates the retired 10s to the nearest survivor", () => {
        // Dropped for its cost, not because it showed nothing new. Falling
        // back to the default would have switched auto-refresh *off* for
        // everyone who had chosen it — a setting change that reads as a bug.
        expect(parseAutoRefresh("10s")).toBe("30s");
    });

    it("falls back to the default for a value that never existed", () => {
        expect(parseAutoRefresh("7h")).toBe(DEFAULT_PREFERENCES.autoRefresh);
    });

    it("falls back for a non-string, which is what an empty preferences column gives", () => {
        expect(parseAutoRefresh(undefined)).toBe(DEFAULT_PREFERENCES.autoRefresh);
        expect(parseAutoRefresh(null)).toBe(DEFAULT_PREFERENCES.autoRefresh);
        expect(parseAutoRefresh(30)).toBe(DEFAULT_PREFERENCES.autoRefresh);
    });
});

describe("parsePreferences", () => {
    it("returns the defaults for an empty object", () => {
        expect(parsePreferences({})).toEqual(DEFAULT_PREFERENCES);
    });

    it("returns the defaults for null, as a fresh user row holds", () => {
        expect(parsePreferences(null)).toEqual(DEFAULT_PREFERENCES);
    });

    it("carries a stored theme and auto-refresh through", () => {
        expect(parsePreferences({ theme: "light", autoRefresh: "60s" })).toEqual({
            theme: "light",
            autoRefresh: "60s",
        });
    });

    it("migrates a stored 10s while leaving the theme alone", () => {
        expect(parsePreferences({ theme: "light", autoRefresh: "10s" })).toEqual({
            theme: "light",
            autoRefresh: "30s",
        });
    });

    it("rejects an unknown theme without disturbing auto-refresh", () => {
        expect(parsePreferences({ theme: "neon", autoRefresh: "5m" })).toEqual({
            theme: DEFAULT_PREFERENCES.theme,
            autoRefresh: "5m",
        });
    });
});

describe("splitAutoRefresh", () => {
    it.each([
        ["30s", "30", "s"],
        ["60s", "60", "s"],
    ] as const)("splits %s into an amount and a seconds unit", (value, amount, unit) => {
        expect(splitAutoRefresh(value)).toEqual({ amount, unit });
    });

    /**
     * The regression this function exists for. The label used to be built by
     * stripping "s" from the value and appending it back from a seconds-only
     * template, so `5m` rendered as **"5ms"** from the day it was added
     * (2026-08-20). Nothing failed: a label assembled inline in a component is
     * a branch no test can reach.
     */
    it("treats a minutes value as minutes, not as seconds", () => {
        expect(splitAutoRefresh("5m")).toEqual({ amount: "5", unit: "m" });
    });

    it("never leaves the unit inside the amount", () => {
        for (const value of ["30s", "60s", "5m"] as const) {
            expect(splitAutoRefresh(value).amount).toMatch(/^[0-9]+$/);
        }
    });
});
