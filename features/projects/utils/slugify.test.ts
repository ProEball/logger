import { describe, it, expect } from "vitest";
import { slugify, slugifyWithSuffix } from "./slugify";

describe("slugify", () => {
    it("converts to lowercase kebab-case", () => {
        expect(slugify("My API Server")).toBe("my-api-server");
    });

    it("strips leading and trailing hyphens", () => {
        expect(slugify("  hello  ")).toBe("hello");
    });

    it("collapses multiple separators", () => {
        expect(slugify("foo   bar---baz")).toBe("foo-bar-baz");
    });

    it("removes unicode diacritics", () => {
        expect(slugify("Café API")).toBe("cafe-api");
    });

    it("handles numbers", () => {
        expect(slugify("v2 endpoint")).toBe("v2-endpoint");
    });

    it("falls back to 'project' for empty/whitespace input", () => {
        expect(slugify("")).toBe("project");
        expect(slugify("   ")).toBe("project");
        expect(slugify("!@#$%")).toBe("project");
    });

    it("truncates to 60 chars", () => {
        const long = "a".repeat(100);
        expect(slugify(long).length).toBeLessThanOrEqual(60);
    });
});

describe("slugifyWithSuffix", () => {
    it("returns base slug on attempt 0", () => {
        expect(slugifyWithSuffix("My Project", 0)).toBe("my-project");
    });

    it("appends suffix on collision attempts", () => {
        expect(slugifyWithSuffix("My Project", 1)).toBe("my-project-2");
        expect(slugifyWithSuffix("My Project", 2)).toBe("my-project-3");
    });

    it("suffix fits within 60 chars", () => {
        const long = "a".repeat(80);
        expect(slugifyWithSuffix(long, 9).length).toBeLessThanOrEqual(60);
    });
});
