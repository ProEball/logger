import { clickhouse } from "@/core/clickhouse/client";
import { ANCHOR_MARKER } from "@/itest/support/fixture";

/**
 * Read the corpus anchor back out of the database.
 *
 * Lives here rather than in `fixture.ts` because that module is imported by
 * the global setup, which runs in vitest's main process — where `test.env` has
 * not been applied and importing `@/core/clickhouse/client` would therefore
 * validate `@/core/env` against whatever the shell happens to hold. The setup
 * builds its own client; only the tests use the app's.
 */
export async function readAnchor(): Promise<Date> {
    const result = await clickhouse.query({
        query: `SELECT toUnixTimestamp64Milli(timestamp) AS ts_ms
                FROM events WHERE message = {marker:String} LIMIT 1`,
        query_params: { marker: ANCHOR_MARKER },
        format: "JSONEachRow",
    });

    const rows = await result.json<{ ts_ms: string }>();
    if (rows.length === 0) {
        throw new Error("anchor marker missing — the corpus was not seeded");
    }
    return new Date(Number(rows[0].ts_ms));
}
