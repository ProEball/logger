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

async function getInviteToken(email: string): Promise<string> {
    const c = new Client({ connectionString: DB_URL });
    await c.connect();
    const { rows } = await c.query(
        `SELECT token FROM invitations WHERE email = $1
         AND accepted_at IS NULL ORDER BY created_at DESC LIMIT 1`,
        [email],
    );
    await c.end();
    if (!rows[0]) throw new Error(`No pending invite for ${email}`);
    return rows[0].token as string;
}

test.describe.serial("Role management — custom roles and permission enforcement", () => {
    const ORG_SLUG = "roles-corp";

    test.beforeAll(async ({ browser }) => {
        await cleanDb();

        // ── Alice runs setup wizard ───────────────────────────────────────
        const setupCtx = await browser.newContext();
        const setupPage = await setupCtx.newPage();
        await setupPage.goto("/");
        await setupPage.waitForURL("**/setup");
        await setupPage.waitForLoadState("networkidle");
        await setupPage.fill('input[placeholder="Acme Inc."]', "Roles Corp");
        await setupPage.keyboard.press("Tab");
        await setupPage.fill('input[placeholder="Jane Smith"]', "Alice Owner");
        await setupPage.keyboard.press("Tab");
        await setupPage.fill('input[placeholder="jane@example.com"]', "alice@roles.test");
        await setupPage.keyboard.press("Tab");
        await setupPage.fill('input[type="password"]', "AlicePass99!");
        await setupPage.keyboard.press("Tab");
        await setupPage.click('button[type="submit"]');
        await setupPage.waitForURL(`**/${ORG_SLUG}`, { timeout: 15_000 });
        await setupCtx.close();

        // ── Alice invites Bob ─────────────────────────────────────────────
        const aliceCtx = await browser.newContext();
        const alicePage = await aliceCtx.newPage();
        await alicePage.goto("/login");
        await alicePage.waitForLoadState("networkidle");
        await alicePage.fill('input[type="email"]', "alice@roles.test");
        await alicePage.keyboard.press("Tab");
        await alicePage.fill('input[type="password"]', "AlicePass99!");
        await alicePage.keyboard.press("Tab");
        await alicePage.click('button[type="submit"]');
        await alicePage.waitForURL(`**/${ORG_SLUG}`, { timeout: 15_000 });

        await alicePage.goto(`/${ORG_SLUG}/team`);
        await alicePage.waitForLoadState("networkidle");
        await alicePage.getByRole("button", { name: "Invite member" }).click();
        await alicePage.getByRole("dialog").waitFor({ timeout: 5_000 });
        await alicePage.fill('input[type="email"]', "bob@roles.test");
        await alicePage.keyboard.press("Tab");
        await alicePage.getByRole("button", { name: "Send invitation" }).click();
        await alicePage
            .getByRole("heading", { name: "Invitation created" })
            .waitFor({ timeout: 10_000 });
        await alicePage.getByRole("button", { name: "Done" }).click();
        await aliceCtx.close();

        // ── Bob registers via invite link ─────────────────────────────────
        const bobToken = await getInviteToken("bob@roles.test");
        const bobCtx = await browser.newContext();
        const bobPage = await bobCtx.newPage();
        await bobPage.goto(`/invite/${bobToken}`);
        await bobPage.waitForLoadState("networkidle");
        await bobPage
            .getByRole("heading", { name: "Create your account" })
            .waitFor({ timeout: 5_000 });
        await bobPage.fill('input[placeholder="Jane Smith"]', "Bob Member");
        await bobPage.keyboard.press("Tab");
        await bobPage.fill('input[type="password"]', "BobPass99!");
        await bobPage.keyboard.press("Tab");
        await bobPage.getByRole("button", { name: "Create account & join" }).click();
        await bobPage.waitForURL(`**/${ORG_SLUG}`, { timeout: 15_000 });
        await bobCtx.close();
    });

    test("owner can create a custom role with restricted permissions", async ({ page }) => {
        await page.goto("/login");
        await page.waitForLoadState("networkidle");
        await page.fill('input[type="email"]', "alice@roles.test");
        await page.keyboard.press("Tab");
        await page.fill('input[type="password"]', "AlicePass99!");
        await page.keyboard.press("Tab");
        await page.click('button[type="submit"]');
        await page.waitForURL(`**/${ORG_SLUG}`, { timeout: 15_000 });

        await page.goto(`/${ORG_SLUG}/settings/roles/new`);
        await page.waitForLoadState("networkidle");

        // Fill name using placeholder (Input component renders a plain <input>)
        await page.fill('input[placeholder="e.g. QA Engineer"]', "QA");

        // Check only "View organization" (org.read) and "Read events" (events.read)
        await page.getByLabel("View organization").check();
        await page.getByLabel("Read events").check();

        await page.getByRole("button", { name: "Create role" }).click();
        await page.waitForURL(`**/${ORG_SLUG}/settings/roles`, { timeout: 10_000 });
        await expect(page.getByText("QA")).toBeVisible();
    });

    test("owner can assign the custom role to a member", async ({ page }) => {
        await page.goto("/login");
        await page.waitForLoadState("networkidle");
        await page.fill('input[type="email"]', "alice@roles.test");
        await page.keyboard.press("Tab");
        await page.fill('input[type="password"]', "AlicePass99!");
        await page.keyboard.press("Tab");
        await page.click('button[type="submit"]');
        await page.waitForURL(`**/${ORG_SLUG}`, { timeout: 15_000 });

        await page.goto(`/${ORG_SLUG}/team`);
        await page.waitForLoadState("networkidle");

        const bobRow = page.getByRole("row").filter({ hasText: "bob@roles.test" });
        await bobRow.getByRole("button", { name: "Member actions" }).click();
        await page.getByRole("button", { name: "Change role" }).click();
        await page.getByRole("heading", { name: /Change role/ }).waitFor({ timeout: 5_000 });

        const roleSelect = page.locator("dialog[open] select");
        const options = await roleSelect.locator("option").all();
        let qaValue = "";
        for (const opt of options) {
            if ((await opt.textContent())?.includes("QA")) {
                qaValue = (await opt.getAttribute("value")) ?? "";
            }
        }
        expect(qaValue).not.toBe("");
        await roleSelect.selectOption(qaValue);

        await page.getByRole("button", { name: "Save" }).click();
        await page
            .getByRole("heading", { name: /Change role/ })
            .waitFor({ state: "hidden", timeout: 5_000 });

        await page.waitForLoadState("networkidle");
        const roleCell = page
            .getByRole("row")
            .filter({ hasText: "bob@roles.test" })
            .getByRole("cell")
            .nth(2);
        await expect(roleCell).toContainText("QA");
    });

    test("user with QA role can access the org overview", async ({ page }) => {
        await page.goto("/login");
        await page.waitForLoadState("networkidle");
        await page.fill('input[type="email"]', "bob@roles.test");
        await page.keyboard.press("Tab");
        await page.fill('input[type="password"]', "BobPass99!");
        await page.keyboard.press("Tab");
        await page.click('button[type="submit"]');
        // Should land on org overview (org.read in QA role)
        await page.waitForURL(`**/${ORG_SLUG}`, { timeout: 15_000 });
        expect(page.url()).toContain(`/${ORG_SLUG}`);
    });

    test("user with QA role cannot access the members page", async ({ page }) => {
        await page.goto("/login");
        await page.waitForLoadState("networkidle");
        await page.fill('input[type="email"]', "bob@roles.test");
        await page.keyboard.press("Tab");
        await page.fill('input[type="password"]', "BobPass99!");
        await page.keyboard.press("Tab");
        await page.click('button[type="submit"]');
        await page.waitForURL(`**/${ORG_SLUG}`, { timeout: 15_000 });

        await page.goto(`/${ORG_SLUG}/team`);
        await page.waitForLoadState("networkidle");

        // Proxy redirects away, or page shows a permission error
        const isForbidden =
            !page.url().includes("/team") ||
            (await page.locator('[role="alert"]').count()) > 0 ||
            (await page.content()).includes("permission");
        expect(isForbidden).toBe(true);
    });
});
