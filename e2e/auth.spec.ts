import { expect, test } from "@playwright/test";
import { withDb } from "@/e2e/support/db";
import { resetDb } from "@/e2e/support/cleanup";
import { bootstrapOrg, login } from "@/e2e/support/auth";

test.describe.serial("Account security — password change revokes other sessions", () => {
    const EMAIL = "alice@auth-security.test";
    const PASS = "AlicePass99!";
    const NEW_PASS = "NewAlicePass99!";
    const ORG_SLUG = "auth-security-corp";

    test.beforeAll(async () => {
        await resetDb();
    });

    test("changing password revokes all other sessions but keeps the current one", async ({ browser }) => {
        // ── 1. Create user via setup wizard (ctx1 = current session) ──────────
        const ctx1 = await browser.newContext();
        const page1 = await ctx1.newPage();
        await bootstrapOrg(page1, {
            orgName: "Auth Security Corp",
            ownerName: "Alice",
            email: EMAIL,
            password: PASS,
            orgSlug: ORG_SLUG,
        });

        // ── 2. Login from second context → second session ─────────────────────
        const ctx2 = await browser.newContext();
        const page2 = await ctx2.newPage();
        await login(page2, EMAIL, PASS, ORG_SLUG);

        // ── 3. Verify 2+ sessions exist ───────────────────────────────────────
        const before = await withDb((c) => c.query("SELECT id FROM sessions"));
        expect(before.rows.length).toBeGreaterThanOrEqual(2);

        // ── 4. Change password from ctx1 ──────────────────────────────────────
        await page1.goto("/account");
        await page1.waitForLoadState("networkidle");
        await page1.locator('input[autocomplete="current-password"]').fill(PASS);
        await page1.locator('input[autocomplete="new-password"]').first().fill(NEW_PASS);
        await page1.locator('input[autocomplete="new-password"]').last().fill(NEW_PASS);
        await page1.getByRole("button", { name: "Change password" }).click();
        // Password hashing + session revocation take real time server-side —
        // wait for the actual completion signal, not just "no network for 500ms"
        // (the request can still be in flight when networkidle fires).
        await page1.getByText("Password changed").waitFor({ timeout: 10_000 });

        // ── 5. Only the current session (ctx1) should remain ──────────────────
        const after = await withDb((c) => c.query("SELECT id FROM sessions"));
        expect(after.rows).toHaveLength(1);

        await ctx1.close();
        await ctx2.close();
    });
});
