import type { ClickhouseEventReadRow } from "./event-row.types";
import type { Event } from "@/shared/types/event.types";

/**
 * A ClickHouse row, back in the shape the UI reads — and the `SELECT` list that
 * produces it.
 *
 * The mirror of `features/ingest/utils/to-clickhouse-row.ts`, and deliberately
 * lossless against it: what the write path flattened — `null` to `""`, an
 * address to `IPv6`, a signed fingerprint to `UInt64` — is unflattened here, so
 * a component cannot tell which store answered it. That is what kept Phase 3 to
 * the read path: `EventsTable`, `EventDrawer` and the rest were untouched.
 *
 * **In `core/clickhouse/` since Phase 4**, moved out of `features/events/utils/`
 * when `shared/services/event-aggregations.service.ts` became its second caller
 * — `recentErrors` returns whole events, and neither `shared/` nor another
 * feature may reach into `features/events` (`PROJECT.md` §2.1). It sits beside
 * the row types it converts, the same reason those moved here in Phase 2.
 *
 * The `SELECT` list lives here rather than in either caller because it and
 * `ClickhouseEventReadRow` are one decision: three columns cannot be read back
 * in their stored form without losing something, and the conversions that fix
 * that are in the projection. Two copies of it would drift the moment one
 * caller added a column.
 */

/**
 * Every column an `Event` needs, converted to what JavaScript can read.
 *
 * The three conversions are not stylistic — each was measured against the
 * server (`lab/clickhouse/probe-read-shapes.mjs`): `DateTime64` renders as
 * `2026-08-26 10:00:00.123`, which is not ISO-8601 and not portably parseable;
 * a `UInt64` read as a JSON number loses its low bits, so it comes back as a
 * string; an `Enum8` renders as its name only through `toString`.
 */
export const EVENT_READ_COLUMNS = `
    id, project_id,
    toUnixTimestamp64Milli(timestamp) AS ts_ms,
    toString(level) AS level, message,
    source, environment, release, error_type,
    user_id, session_id, request_id, trace_id,
    stack_trace, attributes, context, user_agent,
    toString(ip) AS ip,
    toString(template_hash) AS template_hash
`;

/**
 * Settings every event read must carry.
 *
 * Without this an integer stored in `attributes` comes back as `"2"` and the
 * detail panel shows a string where the caller sent a number. It is set **per
 * query** rather than on the client because the same switch rounds a `UInt64`
 * to 18446744073709552000 — which is why `template_hash` is converted inside
 * the `SELECT` above rather than left to the serialiser.
 */
export const EVENT_READ_SETTINGS = { output_format_json_quote_64bit_integers: 0 } as const;

/** What `toClickhouseIp` writes when there was no usable address. */
const UNKNOWN_IP = "::";

const V4_MAPPED_PREFIX = "::ffff:";

/** The write path stored absent as `""`; the UI has always branched on `null`. */
function orNull(value: string): string | null {
    return value === "" ? null : value;
}

/**
 * Undo the `IPv6` column's normalisation.
 *
 * An IPv4 address is stored v4-mapped and reads back as `::ffff:1.2.3.4`.
 * Displaying that instead of `1.2.3.4` would be a visible change to an event's
 * detail panel with no reason behind it, so the mapping is reversed. `::` is
 * the sentinel for "no usable address" and becomes `null`, exactly what
 * Postgres held.
 */
export function fromClickhouseIp(value: string): string | null {
    if (value === "" || value === UNKNOWN_IP) return null;
    if (value.startsWith(V4_MAPPED_PREFIX)) {
        const v4 = value.slice(V4_MAPPED_PREFIX.length);
        // Only the dotted form is a real IPv4 address; `::ffff:1:2` is a
        // legitimate IPv6 address that merely shares the prefix.
        if (v4.includes(".")) return v4;
    }
    return value;
}

/**
 * `context` is stored as an opaque `String` (§4.1: displayed, never filtered),
 * so it comes back serialised.
 *
 * A parse failure returns `{}` rather than throwing. The blob was produced by
 * `JSON.stringify` on the way in and cannot be malformed — but this is a whole
 * page of events failing on one bad row, against a detail tab showing nothing,
 * and only one of those is worth risking.
 */
function parseContext(value: string): Record<string, unknown> {
    if (value === "") return {};
    try {
        const parsed: unknown = JSON.parse(value);
        return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : {};
    } catch {
        return {};
    }
}

export function fromClickhouseRow(row: ClickhouseEventReadRow): Event {
    return {
        id: row.id,
        projectId: row.project_id,
        timestamp: new Date(Number(row.ts_ms)),
        level: row.level,
        message: row.message,
        source: orNull(row.source),
        environment: orNull(row.environment),
        release: orNull(row.release),
        userId: orNull(row.user_id),
        sessionId: orNull(row.session_id),
        requestId: orNull(row.request_id),
        traceId: orNull(row.trace_id),
        errorType: orNull(row.error_type),
        stackTrace: orNull(row.stack_trace),
        attributes: row.attributes,
        context: parseContext(row.context),
        userAgent: orNull(row.user_agent),
        ip: fromClickhouseIp(row.ip),
        // Unsigned, exactly as stored. `BigInt` of the decimal string is exact
        // at any magnitude, which `Number` is not past 2^53 — and this column
        // reaches 2^64.
        templateHash: BigInt(row.template_hash),
    };
}
