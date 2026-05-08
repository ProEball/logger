import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";

const DB_URL = "postgresql://postgres:postgres@localhost:5432/logger";
const ORG_SLUG = "theme-corp";

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

async function loginAlice(page: Page): Promise<void> {
    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    await page.fill('input[type="email"]', "alice@theme.test");
    await page.keyboard.press("Tab");
    await page.fill('input[type="password"]', "AlicePass99!");
    await page.keyboard.press("Tab");
    await page.click('button[type="submit"]');
    await page.waitForURL(`**/${ORG_SLUG}`, { timeout: 15_000 });
}

test.describe.serial("Theme persistence", () => {
    test.beforeAll(async ({ browser }) => {
        await cleanDb();

        const setupCtx = await browser.newContext();
        const setupPage = await setupCtx.newPage();
        await setupPage.goto("/");
        await setupPage.waitForURL("**/setup");
        await setupPage.waitForLoadState("networkidle");
        await setupPage.fill('input[placeholder="Acme Inc."]', "Theme Corp");
        await setupPage.keyboard.press("Tab");
        await setupPage.fill('input[placeholder="Jane Smith"]', "Alice Owner");
        await setupPage.keyboard.press("Tab");
        await setupPage.fill('input[placeholder="jane@example.com"]', "alice@theme.test");
        await setupPage.keyboard.press("Tab");
        await setupPage.fill('input[type="password"]', "AlicePass99!");
        await setupPage.keyboard.press("Tab");
        await setupPage.click('button[type="submit"]');
        await setupPage.waitForURL(`**/${ORG_SLUG}`, { timeout: 15_000 });
        await setupCtx.close();
    });

    test("default theme is dark on first login", async ({ page }) => {
        await loginAlice(page);
        await page.waitForFunction(() => document.documentElement.dataset.theme !== undefined);
        const theme = await page.evaluate(() => document.documentElement.dataset.theme);
        expect(theme).toBe("dark");
    });

    test("switching to light theme updates data-theme immediately", async ({ page }) => {
        await loginAlice(page);

        await page.getByRole("button", { name: "User menu" }).click();
        await page.getByRole("button", { name: "Light" }).click();

        await page.waitForFunction(
            () => document.documentElement.dataset.theme === "light",
        );
        const theme = await page.evaluate(() => document.documentElement.dataset.theme);
        expect(theme).toBe("light");
    });

    test("light theme persists after page reload", async ({ page }) => {
        await loginAlice(page);
        // Theme was saved to DB in previous test; login rehydrates it
        await page.waitForFunction(
            () => document.documentElement.dataset.theme === "light",
        );

        await page.reload();
        await page.waitForLoadState("networkidle");
        await page.waitForFunction(
            () => document.documentElement.dataset.theme !== undefined,
        );

        const theme = await page.evaluate(() => document.documentElement.dataset.theme);
        expect(theme).toBe("light");
    });

    test("light theme persists after logout and re-login", async ({ page }) => {
        await loginAlice(page);
        await page.waitForFunction(
            () => document.documentElement.dataset.theme === "light",
        );

        // Logout via user menu
        await page.getByRole("button", { name: "User menu" }).click();
        await page.getByRole("button", { name: "Sign out" }).click();
        await page.waitForURL("**/login", { timeout: 10_000 });

        // Re-login
        await loginAlice(page);
        await page.waitForFunction(
            () => document.documentElement.dataset.theme !== undefined,
        );

        const theme = await page.evaluate(() => document.documentElement.dataset.theme);
        expect(theme).toBe("light");
    });
});
