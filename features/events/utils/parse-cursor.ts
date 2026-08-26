import type { Cursor } from "./event-filters.types";

/**
 * Parse cursor from URLSearchParams.
 * Invalid cursor returns undefined (resets to first page).
 */
export function parseCursor(params: URLSearchParams): Cursor | undefined {
    const beforeTs = params.get("before_ts");
    const beforeId = params.get("before_id");

    if (!beforeTs || !beforeId) return undefined;

    // Validate ISO timestamp
    const parsed = new Date(beforeTs);
    if (isNaN(parsed.getTime())) return undefined;

    // A real UUID, not a 36-character run of hex and hyphens.
    //
    // The loose check let `------------------------------------` through, and
    // since Phase 3 the value is bound as a ClickHouse `UUID` parameter, where
    // anything unparseable is a server-side error — a 500 on the events page
    // for a hand-edited URL. Postgres was no better; it raised `invalid input
    // syntax for type uuid` on exactly the same input.
    //
    // The rule for this parser is that a malformed cursor resets to the first
    // page, so it has to actually validate.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(beforeId)) {
        return undefined;
    }

    return { beforeTs, beforeId };
}

export function serializeCursor(cursor: Cursor): Record<string, string> {
    return {
        before_ts: cursor.beforeTs,
        before_id: cursor.beforeId,
    };
}
