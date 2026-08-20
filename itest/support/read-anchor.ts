import { sql } from "drizzle-orm";
import { db } from "@/core/db/client";
import { ANCHOR_MARKER } from "@/itest/support/fixture";

/**
 * Read the corpus anchor back out of the database.
 *
 * Lives here rather than in `fixture.ts` because that module is imported by
 * the global setup, which runs in vitest's main process — where `test.env` has
 * not been applied and importing `@/core/db/client` would therefore validate
 * `@/core/env` against whatever the shell happens to hold. The setup talks to
 * Postgres directly; only the tests use the app's client.
 */
export async function readAnchor(): Promise<Date> {
    const rows = await db.execute<{ timestamp: Date }>(sql`
        SELECT timestamp FROM events WHERE message = ${ANCHOR_MARKER} LIMIT 1
    `);
    if (rows.length === 0) {
        throw new Error("anchor marker missing — the corpus was not seeded");
    }
    return new Date(rows[0].timestamp);
}
