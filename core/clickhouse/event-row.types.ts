import type { EventLevel } from "@/features/ingest/utils/event-schema";

/**
 * One row of the ClickHouse `events` table, in the shape that goes over the
 * wire as `JSONEachRow`.
 *
 * **It lives in `core/` rather than in `features/ingest/`** because Phase 3
 * gives it a second consumer in `features/events`, and a feature never imports
 * from another feature (`PROJECT.md` §2.1). The table is app-wide
 * infrastructure; the ingest path is only the first thing to touch it.
 *
 * Every field is a string, a number or a plain object — never a `Date`, a
 * `bigint` or `null` — because those are exactly the three things
 * `JSON.stringify` gets wrong for this table:
 *
 * - a `Date` serialises to ISO-8601 with a `T` and a `Z`, which
 *   `DateTime64(3, 'UTC')` **rejects** (`Cannot parse input: expected '"'
 *   before: 'Z'`). Measured 2026-08-26.
 * - a `bigint` throws outright, and a `number` cannot hold the top bits of a
 *   `UInt64`. Hence `template_hash` as a decimal string.
 * - the schema has **no `Nullable`** anywhere (§4.1: a Nullable column carries
 *   a separate mask and blocks optimizations), so absent means empty string.
 */
export interface ClickhouseEventRow {
    project_id: string;
    /** `YYYY-MM-DD HH:mm:ss.SSS`, UTC. Not ISO-8601 — see above. */
    timestamp: string;
    /** UUIDv7 (`shared/utils/uuidv7.ts`), not the v4 Postgres was given. */
    id: string;

    level: EventLevel;
    message: string;

    source: string;
    environment: string;
    release: string;
    error_type: string;

    user_id: string;
    session_id: string;
    request_id: string;
    trace_id: string;

    /** Unsigned decimal, because the column is `UInt64` and `JSON.stringify`
     *  throws on a `bigint`. */
    template_hash: string;
    /** `normalizeMessage(message)`. Stored per row rather than in a registry
     *  table — the normaliser is TypeScript and has no SQL equivalent, so a
     *  template that is not on the row is one no query can name (§12.4). */
    message_template: string;

    attributes: Record<string, string | number | boolean>;
    /** Displayed, never filtered, so the column is `String` and this is the
     *  serialised blob rather than an object. */
    context: string;
    stack_trace: string;

    user_agent: string;
    /** A valid address or `::`. The column is `IPv6` and an unparseable value
     *  fails the whole insert with code 676 — measured 2026-08-26. */
    ip: string;
}

/**
 * One row of `events` **coming back out**, in the shape the read path's
 * `SELECT` list produces.
 *
 * It is not `ClickhouseEventRow` with the fields reversed, and that is the
 * point: three of the columns cannot be read back in their stored form without
 * losing something, so the query converts them and this type describes what the
 * conversion yields. Measured against the server on 2026-08-26 —
 * `lab/clickhouse/probe-read-shapes.mjs`.
 *
 * - `timestamp` renders as `2026-08-26 10:00:00.123`, which is neither ISO-8601
 *   nor anything `new Date()` parses portably. `toUnixTimestamp64Milli` gives a
 *   number that is exact well past the year 3000.
 * - `template_hash` is a `UInt64`; `Number` would silently lose its low bits,
 *   so it comes back as a decimal string and `BigInt` parses it exactly.
 * - `level` is an `Enum8`, and `toString` makes it the plain name again.
 *
 * `attributes` arrives as an object because the column is `JSON`. Its integer
 * leaves are numbers only under `output_format_json_quote_64bit_integers = 0`,
 * which the read queries set — see `from-event-row.ts`.
 */
export interface ClickhouseEventReadRow {
    id: string;
    project_id: string;
    /** Epoch milliseconds. */
    ts_ms: number | string;
    level: string;
    message: string;

    source: string;
    environment: string;
    release: string;
    error_type: string;

    user_id: string;
    session_id: string;
    request_id: string;
    trace_id: string;

    stack_trace: string;
    attributes: Record<string, unknown>;
    /** The stored blob, still serialised — the column is `String`. */
    context: string;
    user_agent: string;
    /** Always v4-mapped or `::`; the column is `IPv6`. */
    ip: string;
    /** Unsigned decimal, exactly as stored. */
    template_hash: string;
}
