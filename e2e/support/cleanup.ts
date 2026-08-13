import { withDb } from "@/e2e/support/db";

/**
 * Wipes every row in the e2e database. Safe here because logger_test is
 * dedicated to e2e (see playwright.config.ts) — never run this against a
 * database that also holds real data.
 *
 * Order matters: events.project_id and roles are referenced with
 * onDelete "restrict", so dependents must go first.
 */
export async function resetDb(): Promise<void> {
    await withDb(async (c) => {
        await c.query("DELETE FROM alert_notifications");
        await c.query("DELETE FROM alert_rules");
        await c.query("DELETE FROM events");
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
