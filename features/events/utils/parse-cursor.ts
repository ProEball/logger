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

    // Validate UUID-ish id (basic check)
    if (!/^[0-9a-f-]{36}$/.test(beforeId)) return undefined;

    return { beforeTs, beforeId };
}

export function serializeCursor(cursor: Cursor): Record<string, string> {
    return {
        before_ts: cursor.beforeTs,
        before_id: cursor.beforeId,
    };
}
