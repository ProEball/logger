import { describe, it, expect } from "vitest";
import { uuidv7, timestampFromUuidv7 } from "./uuidv7";

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("uuidv7", () => {
    it("produces a canonical UUID string", () => {
        expect(uuidv7()).toMatch(UUID_SHAPE);
    });

    it("sets the version nibble to 7", () => {
        // Postgres `uuid` and ClickHouse `UUID` both accept any version, so a
        // wrong nibble would store and read back fine and only show up as the
        // compression ratio the switch was made for.
        expect(uuidv7().charAt(14)).toBe("7");
    });

    it("sets the RFC 4122 variant bits", () => {
        for (let i = 0; i < 50; i++) {
            expect("89ab").toContain(uuidv7().charAt(19));
        }
    });

    it("encodes the millisecond timestamp it was given", () => {
        const now = Date.UTC(2026, 7, 26, 10, 0, 0, 123);
        expect(timestampFromUuidv7(uuidv7(now))).toBe(now);
    });

    it("encodes the current clock when given no timestamp", () => {
        const before = Date.now();
        const decoded = timestampFromUuidv7(uuidv7());
        const after = Date.now();
        expect(decoded).not.toBeNull();
        expect(decoded as number).toBeGreaterThanOrEqual(before);
        expect(decoded as number).toBeLessThanOrEqual(after);
    });

    it("sorts lexicographically in timestamp order", () => {
        // This is the whole point of the change: ids that arrive in sort order
        // sit next to each other in a granule, which is what lets ZSTD do
        // anything with a column that measured at ratio 1.0 as v4.
        const early = uuidv7(Date.UTC(2020, 0, 1));
        const late = uuidv7(Date.UTC(2030, 0, 1));
        expect(early < late).toBe(true);
    });

    it("is unique across ids minted in the same millisecond", () => {
        const now = Date.now();
        const ids = new Set(Array.from({ length: 1000 }, () => uuidv7(now)));
        expect(ids.size).toBe(1000);
    });

    it("survives a timestamp above 2^40, where naive shifting would wrap", () => {
        // `1 << 40` is 0 in JavaScript's 32-bit bitwise operators, so a
        // shift-based implementation silently truncates every real timestamp.
        // Date.now() has been above 2^40 since 2004.
        const now = 2 ** 44 + 12345;
        expect(timestampFromUuidv7(uuidv7(now))).toBe(now);
    });
});

describe("timestampFromUuidv7", () => {
    it("returns null for a v4 uuid", () => {
        expect(timestampFromUuidv7("f47ac10b-58cc-4372-a567-0e02b2c3d479")).toBeNull();
    });

    it("returns null for a string that is not a uuid", () => {
        expect(timestampFromUuidv7("nope")).toBeNull();
    });
});
