import { expect, test } from "@playwright/test";
import { Client } from "pg";

const DB_URL = "postgresql://postgres:postgres@localhost:5432/logger";

async function cleanDb(): Promise<void> {
    const c = new Client({ connectionString: DB_URL });
    await c.connect();
    await c.query("DELETE FROM organization_members");
    await c.query("DELETE FROM invitations");
    await c.query("DELETE FROM roles");
    await c.query("DELETE FROM organizations");
    await c.query("DELETE FROM accounts");
    await c.query("DELETE FROM sessions");
    await c.query("DELETE FROM verification_tokens");
    await c.query("DELETE FROM users");
    await c.end();
}

test.describe.serial("Account security — password change revokes other sessions", () => {
    const EMAIL = "alice@auth-security.test";
    const PASS = "AlicePass99!";
    const NEW_PASS = "NewAlicePass99!";
    const ORG_SLUG = "auth-security-corp";

    test.beforeAll(async () => {
        await cleanDb();
    });

    test("changing password revokes all other sessions but keeps the current one", async ({ browser }) => {
        // ── 1. Create user via setup wizard (ctx1 = current session) ──────────
        const ctx1 = await browser.newContext();
        const page1 = await ctx1.newPage();
        await page1.goto("/");
        await page1.waitForURL("**/setup");
        await page1.waitForLoadState("networkidle");
        await page1.fill('input[placeholder="Acme Inc."]', "Auth Security Corp");
        await page1.keyboard.press("Tab");
        await page1.fill('input[placeholder="Jane Smith"]', "Alice");
        await page1.keyboard.press("Tab");
        await page1.fill('input[placeholder="jane@example.com"]', EMAIL);
        await page1.keyboard.press("Tab");
        await page1.fill('input[type="password"]', PASS);
        await page1.keyboard.press("Tab");
        await page1.click('button[type="submit"]');
        await page1.waitForURL(`**/${ORG_SLUG}`, { timeout: 15_000 });

        // ── 2. Login from second context → second session ─────────────────────
        const ctx2 = await browser.newContext();
        const page2 = await ctx2.newPage();
        await page2.goto("/login");
        await page2.waitForLoadState("networkidle");
        await page2.fill('input[type="email"]', EMAIL);
        await page2.fill('input[type="password"]', PASS);
        await page2.click('button[type="submit"]');
        await page2.waitForURL(`**/${ORG_SLUG}`, { timeout: 10_000 });

        // ── 3. Verify 2+ sessions exist ───────────────────────────────────────
        const c = new Client({ connectionString: DB_URL });
        await c.connect();
        const { rows: before } = await c.query("SELECT id FROM sessions");
        expect(before.length).toBeGreaterThanOrEqual(2);

        // ── 4. Change password from ctx1 ──────────────────────────────────────
        await page1.goto("/account");
        await page1.waitForLoadState("networkidle");
        await page1.locator('input[autocomplete="current-password"]').fill(PASS);
        await page1.locator('input[autocomplete="new-password"]').first().fill(NEW_PASS);
        await page1.locator('input[autocomplete="new-password"]').last().fill(NEW_PASS);
        await page1.getByRole("button", { name: "Change password" }).click();
        await page1.waitForLoadState("networkidle");

        // ── 5. Only the current session (ctx1) should remain ──────────────────
        const { rows: after } = await c.query("SELECT id FROM sessions");
        await c.end();
        expect(after).toHaveLength(1);

        await ctx1.close();
        await ctx2.close();
    });
});
