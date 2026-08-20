import { describe, it, expect } from "vitest";
import { distinctEnvironments } from "@/features/ingest/utils/distinct-environments";

describe("distinctEnvironments", () => {
    it("returns nothing for an empty batch", () => {
        expect(distinctEnvironments([])).toEqual([]);
    });

    it("collapses repeats", () => {
        const out = distinctEnvironments([
            { environment: "production" },
            { environment: "production" },
            { environment: "staging" },
        ]);
        expect(out.sort()).toEqual(["production", "staging"]);
    });

    it("keeps null as a value, because '(unset)' is a real dropdown option", () => {
        expect(distinctEnvironments([{ environment: null }])).toEqual([null]);
    });

    it("treats a missing property the same as an explicit null", () => {
        expect(distinctEnvironments([{}, { environment: null }])).toEqual([null]);
    });

    it("keeps null alongside real environments rather than dropping either", () => {
        const out = distinctEnvironments([
            { environment: "production" },
            { environment: null },
            { environment: "production" },
        ]);
        expect(out).toHaveLength(2);
        expect(out).toContain("production");
        expect(out).toContain(null);
    });

    it("does not treat an empty string as absent", () => {
        // The ingest schema allows `environment: ""`. Folding it into null
        // would silently relabel it "(unset)" in the filter bar.
        const out = distinctEnvironments([{ environment: "" }, { environment: null }]);
        expect(out).toHaveLength(2);
        expect(out).toContain("");
    });

    it("preserves case, which the database treats as significant", () => {
        const out = distinctEnvironments([{ environment: "Production" }, { environment: "production" }]);
        expect(out).toHaveLength(2);
    });
});
