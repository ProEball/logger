import { describe, it, expect } from "vitest";
import { generateApiKey, extractKeyPrefix } from "./key-generator";
import { hashApiKey } from "./key-hash";

describe("generateApiKey", () => {
    it("starts with lgr_ prefix", () => {
        const key = generateApiKey();
        expect(key.startsWith("lgr_")).toBe(true);
    });

    it("produces unique keys", () => {
        const keys = new Set(Array.from({ length: 100 }, generateApiKey));
        expect(keys.size).toBe(100);
    });

    it("uses base64url safe characters only", () => {
        const key = generateApiKey();
        // base64url: no +, /, = — only A-Z a-z 0-9 - _
        expect(/^lgr_[A-Za-z0-9_-]+$/.test(key)).toBe(true);
    });
});

describe("extractKeyPrefix", () => {
    it("returns first 4 chars after lgr_", () => {
        expect(extractKeyPrefix("lgr_aBcDeFgH")).toBe("aBcD");
    });
});

describe("hashApiKey", () => {
    it("produces 64-char hex string", () => {
        const hash = hashApiKey("lgr_test");
        expect(hash).toHaveLength(64);
        expect(/^[0-9a-f]+$/.test(hash)).toBe(true);
    });

    it("is deterministic", () => {
        expect(hashApiKey("lgr_test")).toBe(hashApiKey("lgr_test"));
    });

    it("different keys produce different hashes", () => {
        const k1 = generateApiKey();
        const k2 = generateApiKey();
        expect(hashApiKey(k1)).not.toBe(hashApiKey(k2));
    });

    it("roundtrip: generate → hash → lookup matches", () => {
        const key = generateApiKey();
        const hash = hashApiKey(key);
        // Simulate lookup: hash the same key again
        expect(hashApiKey(key)).toBe(hash);
    });
});
