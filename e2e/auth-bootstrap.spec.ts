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

test.describe.serial("Auth bootstrap — setup wizard flow", () => {
    test.beforeAll(async () => {
        await cleanDb();
    });

    test("unauthenticated root redirects to /setup when no users exist", async ({ page }) => {
        await page.goto("/");
        await page.waitForURL("**/setup");
    });

    test("setup wizard creates owner, org, and three system roles", async ({ page }) => {
        await page.goto("/setup");
        await page.waitForLoadState("networkidle");

        await page.fill('input[placeholder="Acme Inc."]', "Bootstrap Corp");
        await page.keyboard.press("Tab");
        await page.fill('input[placeholder="Jane Smith"]', "Alice Owner");
        await page.keyboard.press("Tab");
        await page.fill('input[placeholder="jane@example.com"]', "alice@bootstrap.test");
        await page.keyboard.press("Tab");
        await page.fill('input[type="password"]', "AlicePass99!");
        await page.keyboard.press("Tab");
        await page.click('button[type="submit"]');
        await page.waitForURL("**/bootstrap-corp", { timeout: 15_000 });

        const c = new Client({ connectionString: DB_URL });
        await c.connect();
        const { rows: users } = await c.query("SELECT id FROM users");
        const { rows: orgs } = await c.query("SELECT slug FROM organizations");
        const { rows: members } = await c.query("SELECT is_owner FROM organization_members");
        const { rows: roles } = await c.query("SELECT name FROM roles ORDER BY name");
        await c.end();

        expect(users).toHaveLength(1);
        expect(orgs[0].slug).toBe("bootstrap-corp");
        expect(members[0].is_owner).toBe(true);
        expect(roles.map((r: { name: string }) => r.name)).toEqual(["Admin", "Member", "Viewer"]);
    });

    test("/setup returns 404 once an owner exists", async ({ page }) => {
        const response = await page.request.get("/setup");
        expect(response.status()).toBe(404);
    });

    test("navigating to /setup after bootstrap redirects or shows 404", async ({ browser }) => {
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        await page.goto("/setup");
        await page.waitForLoadState("networkidle");

        // Proxy blocks the page — either redirected away or content contains 404
        const blocked =
            !page.url().endsWith("/setup") ||
            (await page.content()).includes("404");

        await ctx.close();
        expect(blocked).toBe(true);
    });
});
