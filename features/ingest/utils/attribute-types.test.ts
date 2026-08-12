import { describe, it, expect } from "vitest";
import {
    inferAttributeType,
    collectCandidateTypes,
    findAttributeTypeConflicts,
} from "./attribute-types";

describe("inferAttributeType", () => {
    it("returns null for null values", () => {
        expect(inferAttributeType(null)).toBeNull();
    });

    it("infers string, number, boolean", () => {
        expect(inferAttributeType("x")).toBe("string");
        expect(inferAttributeType(5)).toBe("number");
        expect(inferAttributeType(true)).toBe("boolean");
    });
});

describe("collectCandidateTypes", () => {
    it("registers a new key with its type", () => {
        const candidates = collectCandidateTypes([{ count: 5 }]);
        expect(candidates.get("count")).toBe("number");
    });

    it("skips null values", () => {
        const candidates = collectCandidateTypes([{ count: null }]);
        expect(candidates.has("count")).toBe(false);
    });

    it("keeps only the first type seen for a key across a batch", () => {
        const candidates = collectCandidateTypes([{ count: 5 }, { count: "5" }]);
        expect(candidates.get("count")).toBe("number");
    });
});

describe("findAttributeTypeConflicts", () => {
    it("passes when attribute type matches the resolved map", () => {
        const resolved = new Map([["count", "number" as const]]);
        const conflicts = findAttributeTypeConflicts([{ count: 5 }], resolved);
        expect(conflicts).toHaveLength(0);
    });

    it("flags a mismatched type", () => {
        const resolved = new Map([["count", "number" as const]]);
        const conflicts = findAttributeTypeConflicts([{ count: "5" }], resolved);
        expect(conflicts).toEqual([
            { index: 0, key: "count", message: expect.stringContaining("count") },
        ]);
    });

    it("ignores null values", () => {
        const resolved = new Map([["count", "number" as const]]);
        const conflicts = findAttributeTypeConflicts([{ count: null }], resolved);
        expect(conflicts).toHaveLength(0);
    });

    it("flags only the later, conflicting event when a batch introduces a new key twice with different types", () => {
        const attributesList = [{ count: 5 }, { count: "5" }];
        const resolved = collectCandidateTypes(attributesList);
        const conflicts = findAttributeTypeConflicts(attributesList, resolved);
        expect(conflicts).toEqual([
            { index: 1, key: "count", message: expect.stringContaining("count") },
        ]);
    });
});
