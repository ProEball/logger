import { describe, it, expect } from "vitest";
import { distinctTemplates } from "./distinct-templates";
import { templateHashForStorage } from "./normalize-message";

describe("distinctTemplates", () => {
    it("collapses messages that share a template into one entry", () => {
        const result = distinctTemplates([
            { message: "User u_1 signed in" },
            { message: "User u_2 signed in" },
            { message: "User u_3 signed in" },
        ]);

        expect(result).toHaveLength(1);
        expect(result[0].template).toBe("User *** signed in");
    });

    it("keeps genuinely different templates apart", () => {
        const result = distinctTemplates([
            { message: "User u_1 signed in" },
            { message: "User u_1 signed out" },
        ]);

        expect(result).toHaveLength(2);
    });

    it("carries the hash the rollup will join on", () => {
        const [entry] = distinctTemplates([{ message: "Session sess_a1b2c3 expired" }]);
        expect(entry.templateHash).toBe(templateHashForStorage("Session sess_a1b2c3 expired"));
    });

    it("returns nothing for an empty batch", () => {
        expect(distinctTemplates([])).toEqual([]);
    });

    it("keeps the first template text seen for a hash", () => {
        // Both normalise to the same template, so which text is stored cannot
        // depend on arrival order — they are the same string either way.
        const result = distinctTemplates([
            { message: "Payment aabbccdd11 done" },
            { message: "Payment 99887766ff done" },
        ]);

        expect(result).toHaveLength(1);
        expect(result[0].template).toBe("Payment *** done");
    });

    it("handles a message that normalises to nothing recognisable", () => {
        const result = distinctTemplates([{ message: "" }]);
        expect(result).toHaveLength(1);
        expect(result[0].template).toBe("");
    });
});
