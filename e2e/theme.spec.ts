import { expect, test } from "@playwright/test";
import { withDb } from "@/e2e/support/db";
import { resetDb } from "@/e2e/support/cleanup";
import { bootstrapOrg, login } from "@/e2e/support/auth";

const ORG_SLUG = "theme-corp";
const EMAIL = "alice@theme.test";
const PASS = "AlicePass99!";

test.describe.serial("Theme persistence", () => {
    test.beforeAll(async ({ browser }) => {
        await resetDb();

        const setupCtx = await browser.newContext();
        const setupPage = await setupCtx.newPage();
        await bootstrapOrg(setupPage, {
            orgName: "Theme Corp",
            ownerName: "Alice Owner",
            email: EMAIL,
            password: PASS,
            orgSlug: ORG_SLUG,
        });
        await setupCtx.close();
    });

    test("default theme is dark on first login", async ({ page }) => {
        await login(page, EMAIL, PASS, ORG_SLUG);
        await page.waitForFunction(() => document.documentElement.dataset.theme !== undefined);
        const theme = await page.evaluate(() => document.documentElement.dataset.theme);
        expect(theme).toBe("dark");
    });

    test("switching to light theme updates data-theme immediately", async ({ page }) => {
        await login(page, EMAIL, PASS, ORG_SLUG);

        await page.getByRole("button", { name: "User menu" }).click();
        await page.getByRole("button", { name: "Light" }).click();

        await page.waitForFunction(
            () => document.documentElement.dataset.theme === "light",
        );
        const theme = await page.evaluate(() => document.documentElement.dataset.theme);
        expect(theme).toBe("light");

        // The DOM flips before the preference is persisted server-side (Redux
        // dispatch is synchronous, the save is a background request) — the
        // next test logs in fresh and needs the saved DB value, so wait for
        // that write to actually land rather than trusting page-level "idle".
        await expect
            .poll(async () => {
                const { rows } = await withDb((c) =>
                    c.query("SELECT preferences->>'theme' AS theme FROM users WHERE email = $1", [EMAIL]),
                );
                return rows[0]?.theme;
            }, { timeout: 10_000 })
            .toBe("light");
    });

    test("light theme persists after page reload", async ({ page }) => {
        await login(page, EMAIL, PASS, ORG_SLUG);
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
        await login(page, EMAIL, PASS, ORG_SLUG);
        await page.waitForFunction(
            () => document.documentElement.dataset.theme === "light",
        );

        // Logout via user menu
        await page.getByRole("button", { name: "User menu" }).click();
        await page.getByRole("button", { name: "Sign out" }).click();
        await page.waitForURL("**/login", { timeout: 10_000 });

        // Re-login
        await login(page, EMAIL, PASS, ORG_SLUG);
        await page.waitForFunction(
            () => document.documentElement.dataset.theme !== undefined,
        );

        const theme = await page.evaluate(() => document.documentElement.dataset.theme);
        expect(theme).toBe("light");
    });
});
