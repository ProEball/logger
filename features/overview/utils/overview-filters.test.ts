import { describe, it, expect } from "vitest";
import {
    DEFAULT_OVERVIEW_PRESET,
    OVERVIEW_BUCKET_SECONDS,
    OVERVIEW_PRESETS,
    parseOverviewFilters,
} from "@/features/overview/utils/overview-filters";

describe("parseOverviewFilters — range preset", () => {
    it("falls back to the default when `range` is absent", () => {
        expect(parseOverviewFilters({}).preset).toBe(DEFAULT_OVERVIEW_PRESET);
    });

    it("falls back to the default for a value that is not a preset", () => {
        expect(parseOverviewFilters({ range: "99d" }).preset).toBe(DEFAULT_OVERVIEW_PRESET);
    });

    it("is case-sensitive, so `1H` is not accepted", () => {
        expect(parseOverviewFilters({ range: "1H" }).preset).toBe(DEFAULT_OVERVIEW_PRESET);
    });

    it("falls back when `range` arrives repeated, as an array", () => {
        expect(parseOverviewFilters({ range: ["1h", "24h"] }).preset).toBe(DEFAULT_OVERVIEW_PRESET);
    });

    it("falls back on an empty string rather than producing an empty preset", () => {
        expect(parseOverviewFilters({ range: "" }).preset).toBe(DEFAULT_OVERVIEW_PRESET);
    });

    it.each(OVERVIEW_PRESETS)("accepts the preset %s and gives it a bucket width", (preset) => {
        const filters = parseOverviewFilters({ range: preset });
        expect(filters.preset).toBe(preset);
        expect(filters.bucketSecs).toBe(OVERVIEW_BUCKET_SECONDS[preset]);
        expect(filters.bucketSecs).toBeGreaterThan(0);
    });

    it("gives every preset a bucket width, so no range can chart at zero seconds", () => {
        for (const preset of OVERVIEW_PRESETS) {
            expect(OVERVIEW_BUCKET_SECONDS[preset]).toBeGreaterThan(0);
        }
    });
});

describe("parseOverviewFilters — environment", () => {
    it("returns no filter when `env` is absent", () => {
        const filters = parseOverviewFilters({});
        expect(filters.environment).toBe("");
        expect(filters.environmentsFilter).toBeUndefined();
    });

    it("treats an empty `env` as no filter", () => {
        expect(parseOverviewFilters({ env: "" }).environmentsFilter).toBeUndefined();
    });

    it("wraps a selected environment in an array for the service", () => {
        const filters = parseOverviewFilters({ env: "production" });
        expect(filters.environment).toBe("production");
        expect(filters.environmentsFilter).toEqual(["production"]);
    });

    it("ignores a repeated `env` param", () => {
        expect(parseOverviewFilters({ env: ["a", "b"] }).environmentsFilter).toBeUndefined();
    });
});

describe("parseOverviewFilters — searchString", () => {
    it("is empty when there is nothing to preserve", () => {
        expect(parseOverviewFilters({}).searchString).toBe("");
    });

    it("keeps the params the filter bar needs to round-trip", () => {
        const filters = parseOverviewFilters({ range: "24h", env: "production" });
        expect(filters.searchString).toBe("range=24h&env=production");
    });

    it("omits params with an empty value", () => {
        expect(parseOverviewFilters({ range: "24h", env: "" }).searchString).toBe("range=24h");
    });

    it("omits repeated params rather than guessing which value was meant", () => {
        expect(parseOverviewFilters({ range: "24h", env: ["a", "b"] }).searchString).toBe("range=24h");
    });

    it("percent-encodes a value so the query string cannot be broken by it", () => {
        const filters = parseOverviewFilters({ q: "a&b=c d" });
        expect(filters.searchString).toBe("q=a%26b%3Dc%20d");
    });

    it("passes through params it does not itself understand", () => {
        // The filter bar owns params this parser has no opinion on; dropping
        // them would silently reset the user's filters on every navigation.
        expect(parseOverviewFilters({ sort: "count" }).searchString).toBe("sort=count");
    });

    it("carries the raw range through even when the preset was rejected", () => {
        // The page renders `preset`, not this string, so the two disagreeing
        // is intended: the URL keeps what the user typed.
        const filters = parseOverviewFilters({ range: "99d" });
        expect(filters.preset).toBe(DEFAULT_OVERVIEW_PRESET);
        expect(filters.searchString).toBe("range=99d");
    });
});
