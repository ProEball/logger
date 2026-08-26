import { describe, it, expect } from "vitest";
import { parseCursor, serializeCursor } from "./parse-cursor";

/**
 * `parse-cursor.ts` had no test until Phase 3 of the ClickHouse migration, and
 * the gap was load-bearing: its id check accepted any 36 characters of hex and
 * hyphen, which is not a UUID. The value is bound as a ClickHouse `UUID`
 * parameter, so an unparseable one is a server error rather than a first page.
 *
 * Both halves are exercised, because a cursor that cannot be re-read is the
 * same bug as one that is not validated.
 */

const ID = "01920000-0000-7000-8000-000000000001";
const TS = "2026-08-26T10:00:00.123Z";

function params(entries: Record<string, string>): URLSearchParams {
    return new URLSearchParams(entries);
}

describe("parseCursor", () => {
    it("reads a well-formed pair", () => {
        expect(parseCursor(params({ before_ts: TS, before_id: ID }))).toEqual({
            beforeTs: TS,
            beforeId: ID,
        });
    });

    it("returns nothing when either half is missing", () => {
        expect(parseCursor(params({ before_ts: TS }))).toBeUndefined();
        expect(parseCursor(params({ before_id: ID }))).toBeUndefined();
        expect(parseCursor(params({}))).toBeUndefined();
    });

    it("returns nothing for an unparseable timestamp", () => {
        expect(parseCursor(params({ before_ts: "yesterday", before_id: ID }))).toBeUndefined();
    });

    it("rejects a 36-character string that is not a UUID", () => {
        // The old check was /^[0-9a-f-]{36}$/, which this passes.
        expect(parseCursor(params({ before_ts: TS, before_id: "-".repeat(36) }))).toBeUndefined();
        expect(
            parseCursor(params({ before_ts: TS, before_id: "0192000000007000800000000000001a" + "----" })),
        ).toBeUndefined();
    });

    it("rejects a UUID with the wrong shape or length", () => {
        expect(parseCursor(params({ before_ts: TS, before_id: ID.slice(0, 35) }))).toBeUndefined();
        expect(parseCursor(params({ before_ts: TS, before_id: `${ID}0` }))).toBeUndefined();
        expect(parseCursor(params({ before_ts: TS, before_id: ID.replace("-", "") }))).toBeUndefined();
    });

    it("rejects non-hex characters", () => {
        expect(
            parseCursor(params({ before_ts: TS, before_id: ID.replace("0192", "019z") })),
        ).toBeUndefined();
    });

    it("accepts an upper-case UUID", () => {
        // Nothing emits one, but rejecting it would turn a copied URL into a
        // silent reset to page one.
        const upper = ID.toUpperCase();
        expect(parseCursor(params({ before_ts: TS, before_id: upper }))).toEqual({
            beforeTs: TS,
            beforeId: upper,
        });
    });
});

describe("serializeCursor", () => {
    it("round-trips through the query string", () => {
        const cursor = { beforeTs: TS, beforeId: ID };
        expect(parseCursor(params(serializeCursor(cursor)))).toEqual(cursor);
    });
});
