import { isIP } from "net";
import type { NewEvent } from "@/shared/types/event.types";
import type { ClickhouseEventRow } from "@/core/clickhouse/event-row.types";
import type { EventLevel } from "./event-schema";

/** What `IPv6` holds when the request carried no usable address. */
export const UNKNOWN_IP = "::";

/**
 * `DateTime64(3, 'UTC')` wants `YYYY-MM-DD HH:mm:ss.SSS` and rejects
 * ISO-8601's `T`/`Z` outright — measured against ClickHouse 25.3 on
 * 2026-08-26, `Cannot parse input: expected '"' before: 'Z'`.
 *
 * A numeric epoch is also accepted, and deliberately not used: the integer is
 * read as the column's own tick count, so the same number means a different
 * instant if the scale ever changes from 3. The string says what it means.
 */
export function formatClickhouseDateTime(date: Date): string {
    const iso = date.toISOString(); // 2026-08-26T10:00:00.123Z
    return `${iso.slice(0, 10)} ${iso.slice(11, 23)}`;
}

/**
 * Coerces whatever arrived in `X-Forwarded-For` into something the `IPv6`
 * column will accept.
 *
 * **This is a guard, not a formality.** The header is client-controlled and
 * ClickHouse fails the *entire insert* on an unparseable address (code 676,
 * measured 2026-08-26) — under a batch that means every event in the request
 * is lost to one malformed proxy header. Postgres stored the raw text and did
 * not care.
 *
 * Coerce rather than reject: an ingest request must not 400 because something
 * upstream wrote `1.2.3.4:5678` into a header the caller never set. The
 * diagnostic value of a mangled address is nil, so `::` — "not known" — loses
 * nothing that was there.
 *
 * `net.isIP` does the validating. It is Node's own parser, which is the same
 * decision as mocking DNS rather than reimplementing it: a hand-written IPv6
 * regex is a well-known source of both false accepts and false rejects.
 * ClickHouse stores a v4 address v4-mapped (`1.2.3.4` reads back as
 * `::ffff:1.2.3.4`), so no mapping is needed here.
 */
export function toClickhouseIp(value: string | null | undefined): string {
    if (!value) return UNKNOWN_IP;
    const trimmed = value.trim();
    return isIP(trimmed) === 0 ? UNKNOWN_IP : trimmed;
}

/**
 * Drops attribute keys whose value is `null`.
 *
 * §4.3 left this open and recommended dropping: a null carries no information
 * and would spend one of the JSON column's path slots, which §14.3.2 measured
 * to be the binding resource — memory per distinct path, biting around 180
 * paths across the whole install.
 *
 * ClickHouse happens to drop them too (a null-valued path is not created —
 * measured 2026-08-26), so this is belt and braces. It is here anyway so the
 * stored shape is a property of this repository's code rather than of an
 * engine detail that could change between versions.
 */
export function dropNullAttributes(
    attributes: Record<string, string | number | boolean | null> | null | undefined,
): Record<string, string | number | boolean> {
    const kept: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(attributes ?? {})) {
        if (value !== null) kept[key] = value;
    }
    return kept;
}

/**
 * An enriched event as the one row ClickHouse stores.
 *
 * The dual write it was written for is gone — Phase 4 deleted the Postgres
 * insert — so this is now the only mapper on the write path, and
 * `core/clickhouse/from-event-row.ts` is its mirror on the way back.
 */
export function toClickhouseRow(row: NewEvent): ClickhouseEventRow {
    return {
        project_id: row.projectId,
        timestamp: formatClickhouseDateTime(row.timestamp),
        id: row.id,

        // `level` is a plain string on the enriched row and an `Enum8` in the
        // column; the ingest schema has already validated it against the same
        // five names, which is what makes this narrowing safe rather than
        // hopeful.
        level: row.level as EventLevel,
        message: row.message,

        source: row.source ?? "",
        environment: row.environment ?? "",
        release: row.release ?? "",
        error_type: row.errorType ?? "",

        user_id: row.userId ?? "",
        session_id: row.sessionId ?? "",
        request_id: row.requestId ?? "",
        trace_id: row.traceId ?? "",

        // A decimal string, because the column is `UInt64` and `JSON.stringify`
        // throws on a `bigint`. No fold in either direction since Phase 4 — the
        // hash is unsigned and so is the column.
        template_hash: row.templateHash.toString(),
        // Stored on the row rather than looked up in a registry table: the
        // normaliser is TypeScript and has no SQL equivalent, so a template
        // that is not on the row is a template no query can name. See §12.4.
        message_template: row.messageTemplate,

        attributes: dropNullAttributes(row.attributes),
        context: JSON.stringify(row.context ?? {}),
        stack_trace: row.stackTrace ?? "",

        user_agent: row.userAgent ?? "",
        ip: toClickhouseIp(row.ip),
    };
}
