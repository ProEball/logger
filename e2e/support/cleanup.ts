import { createClient } from "@clickhouse/client";
import { withDb } from "@/e2e/support/db";

/**
 * Wipes every row in the e2e databases. Safe here because `logger_test` — in
 * both stores — is dedicated to e2e (see playwright.config.ts and
 * scripts/bootstrap-e2e.mjs); never run this against a database that also
 * holds real data.
 */

/**
 * ClickHouse holds the events, and since Phase 4 it is the **only** store that
 * does — `DELETE FROM events` on the Postgres side is gone with the table.
 *
 * If this were skipped, events would survive a reset that removed the projects
 * they belong to, and the specs that assert on a count would drift upward run
 * after run — passing on the first run of the day and failing later, which is
 * the worst failure mode a suite can have.
 *
 * `TRUNCATE`, not `DELETE`: ClickHouse's `DELETE` is a mutation, applied
 * asynchronously, so a spec could read rows that were "deleted" a moment ago.
 *
 * A local client rather than `core/clickhouse/client.ts`: this runs in the
 * Playwright worker, which does not load the app's env schema.
 */
async function resetClickhouse(): Promise<void> {
    const client = createClient({
        url: process.env.CLICKHOUSE_URL ?? "http://localhost:8123",
        username: process.env.CLICKHOUSE_USER ?? "logger",
        password: process.env.CLICKHOUSE_PASSWORD ?? "logger",
        database: process.env.CLICKHOUSE_DATABASE ?? "logger_test",
    });
    try {
        await client.command({ query: "TRUNCATE TABLE IF EXISTS events" });
    } finally {
        await client.close();
    }
}

/**
 * Order matters on the Postgres side: roles are referenced with onDelete
 * "restrict", so dependents must go first.
 *
 * `events` used to head this list for the same reason. Its foreign key to
 * `projects` is one of the things the move to a second store gave up — see
 * `docs/reference/security.md`.
 */
export async function resetDb(): Promise<void> {
    await resetClickhouse();

    await withDb(async (c) => {
        await c.query("DELETE FROM alert_notifications");
        await c.query("DELETE FROM alert_rules");
        await c.query("DELETE FROM attribute_key_types");
        await c.query("DELETE FROM api_keys");
        await c.query("DELETE FROM project_member_roles");
        await c.query("DELETE FROM organization_members");
        await c.query("DELETE FROM invitations");
        await c.query("DELETE FROM projects");
        await c.query("DELETE FROM roles");
        await c.query("DELETE FROM organizations");
        await c.query("DELETE FROM sessions");
        await c.query("DELETE FROM accounts");
        await c.query("DELETE FROM verification_tokens");
        await c.query("DELETE FROM users");
    });
}
