import { describe, it, expect } from "vitest";
import {
    dedupToken,
    dedupTokenFromRequest,
    IDEMPOTENCY_HEADER,
    MAX_IDEMPOTENCY_KEY_LENGTH,
} from "./dedup-token";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const OTHER_PROJECT = "22222222-2222-4222-8222-222222222222";

describe("dedupToken", () => {
    it("returns a token when the caller supplied a key", () => {
        expect(dedupToken(PROJECT, "batch-1")).toBe(`${PROJECT}:batch-1`);
    });

    it("scopes the token by project", () => {
        // ClickHouse's deduplication window belongs to the table, not to a
        // tenant. Two projects both sending `retry` would otherwise discard
        // each other's events, and nothing would report an error.
        expect(dedupToken(PROJECT, "retry")).not.toBe(dedupToken(OTHER_PROJECT, "retry"));
    });

    it("is stable, so a retry of the same request produces the same token", () => {
        expect(dedupToken(PROJECT, "batch-1")).toBe(dedupToken(PROJECT, "batch-1"));
    });

    it("trims surrounding whitespace before comparing", () => {
        expect(dedupToken(PROJECT, "  batch-1  ")).toBe(dedupToken(PROJECT, "batch-1"));
    });

    it.each([
        ["null", null],
        ["undefined", undefined],
        ["an empty key", ""],
        ["a whitespace-only key", "   "],
    ])("returns null for %s, so the insert carries no token", (_label, key) => {
        expect(dedupToken(PROJECT, key)).toBeNull();
    });

    it("accepts a key at the length limit", () => {
        const key = "k".repeat(MAX_IDEMPOTENCY_KEY_LENGTH);
        expect(dedupToken(PROJECT, key)).toBe(`${PROJECT}:${key}`);
    });

    it("ignores a key one character past the limit rather than truncating it", () => {
        // Truncating would map two distinct keys onto one token, which
        // deduplicates two different batches into one — the exact failure the
        // token is supposed to prevent, inverted.
        expect(dedupToken(PROJECT, "k".repeat(MAX_IDEMPOTENCY_KEY_LENGTH + 1))).toBeNull();
    });
});

describe("dedupTokenFromRequest", () => {
    function request(headers: Record<string, string> = {}): Request {
        return new Request("https://example.test/api/ingest", { method: "POST", headers });
    }

    it("reads the idempotency key off the request", () => {
        const req = request({ [IDEMPOTENCY_HEADER]: "abc" });
        expect(dedupTokenFromRequest(req, PROJECT)).toBe(`${PROJECT}:abc`);
    });

    it("matches the header case-insensitively, as HTTP requires", () => {
        const req = request({ "Idempotency-Key": "abc" });
        expect(dedupTokenFromRequest(req, PROJECT)).toBe(`${PROJECT}:abc`);
    });

    it("returns null when the request sent no key", () => {
        expect(dedupTokenFromRequest(request(), PROJECT)).toBeNull();
    });
});
