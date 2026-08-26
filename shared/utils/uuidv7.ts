import { randomBytes } from "crypto";

/**
 * A UUIDv7 — 48 bits of millisecond timestamp, then randomness.
 *
 * **Why not `randomUUID()`.** v4 is 16 fully random bytes, and Phase 0 measured
 * what that costs in ClickHouse: `id` compressed at ratio **1.0** and was a
 * fifth of the whole table (docs/features/09-clickhouse.md §14.2). Sorted
 * within a granule by `(project_id, timestamp, id)`, a v7's leading bytes are
 * near-constant, so ZSTD has something to work with. It also improves insert
 * locality, because ids arrive roughly in sort order rather than scattered.
 *
 * **Written out rather than taken from a dependency**, for the same reason as
 * `templateHash`: the value is persisted, so the function has to produce the
 * same *shape* next year on another Node version. RFC 9562 §5.7 is 15 lines,
 * and Node 22's `crypto.randomUUID` is v4-only with no option to change that.
 *
 * No monotonic counter for ids minted inside the same millisecond. Sorting
 * within a millisecond is arbitrary either way, and `id` is in the sort key
 * only to make keyset pagination deterministic — it never has to mean
 * "happened after".
 */
export function uuidv7(now: number = Date.now()): string {
    const bytes = randomBytes(16);

    // 48-bit big-endian millisecond timestamp. `now` is well under 2^48, so
    // the arithmetic stays inside the safe integer range without BigInt.
    bytes[0] = Math.floor(now / 2 ** 40) & 0xff;
    bytes[1] = Math.floor(now / 2 ** 32) & 0xff;
    bytes[2] = Math.floor(now / 2 ** 24) & 0xff;
    bytes[3] = Math.floor(now / 2 ** 16) & 0xff;
    bytes[4] = Math.floor(now / 2 ** 8) & 0xff;
    bytes[5] = now & 0xff;

    // Version 7 in the high nibble of byte 6, RFC 4122 variant in byte 8.
    bytes[6] = (bytes[6] & 0x0f) | 0x70;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    const hex = bytes.toString("hex");
    return [
        hex.slice(0, 8),
        hex.slice(8, 12),
        hex.slice(12, 16),
        hex.slice(16, 20),
        hex.slice(20, 32),
    ].join("-");
}

/**
 * The millisecond timestamp encoded in a UUIDv7, or `null` if the value is not
 * a v7.
 *
 * Exists so the version claim above is checkable rather than asserted — the
 * test reads a generated id back and compares it with the clock it was given.
 */
export function timestampFromUuidv7(uuid: string): number | null {
    const hex = uuid.replace(/-/g, "");
    if (hex.length !== 32) return null;
    if (hex[12] !== "7") return null;
    return parseInt(hex.slice(0, 12), 16);
}
