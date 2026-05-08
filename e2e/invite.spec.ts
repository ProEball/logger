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

test.describe("Invitation flow", () => {
    let orgSlug: string;
    let bobInviteToken: string;
    let charlieInviteToken: string;

    test.beforeAll(async ({ browser }) => {
        await cleanDb();

        // ── Alice runs setup wizard ───────────────────────────────────────
        const setupCtx = await browser.newContext();
        const setupPage = await setupCtx.newPage();
        await setupPage.goto("/");
        await setupPage.waitForURL("**/setup");
        await setupPage.waitForLoadState("networkidle");
        await setupPage.fill('input[placeholder="Acme Inc."]', "Invite Corp");
        await setupPage.keyboard.press("Tab");
        await setupPage.fill('input[placeholder="Jane Smith"]', "Alice Owner");
        await setupPage.keyboard.press("Tab");
        await setupPage.fill('input[placeholder="jane@example.com"]', "alice@invite.test");
        await setupPage.keyboard.press("Tab");
        await setupPage.fill('input[type="password"]', "AlicePass99!");
        await setupPage.keyboard.press("Tab");
        await setupPage.click('button[type="submit"]');
        await setupPage.waitForURL("**/invite-corp", { timeout: 15_000 });
        orgSlug = "invite-corp";
        await setupCtx.close();

        // ── Alice invites Bob and Charlie ─────────────────────────────────
        const aliceCtx = await browser.newContext();
        const alicePage = await aliceCtx.newPage();
        await alicePage.goto("/login");
        await alicePage.waitForLoadState("networkidle");
        await alicePage.fill('input[type="email"]', "alice@invite.test");
        await alicePage.keyboard.press("Tab");
        await alicePage.fill('input[type="password"]', "AlicePass99!");
        await alicePage.keyboard.press("Tab");
        await alicePage.click('button[type="submit"]');
        await alicePage.waitForURL("**/invite-corp", { timeout: 15_000 });

        for (const email of ["bob@invite.test", "charlie@invite.test"]) {
            await alicePage.goto(`/${orgSlug}/team`);
            await alicePage.waitForLoadState("networkidle");
            await alicePage.getByRole("button", { name: "Invite member" }).click();
            await alicePage.getByRole("dialog").waitFor({ timeout: 5_000 });
            await alicePage.fill('input[type="email"]', email);
            await alicePage.keyboard.press("Tab");
            await alicePage.getByRole("button", { name: "Send invitation" }).click();
            await alicePage
                .getByRole("heading", { name: "Invitation created" })
                .waitFor({ timeout: 10_000 });
            await alicePage.getByRole("button", { name: "Done" }).click();
        }
        await aliceCtx.close();

        bobInviteToken = await getInviteToken("bob@invite.test");
        charlieInviteToken = await getInviteToken("charlie@invite.test");

        // ── Bob registers via invite link ─────────────────────────────────
        const bobCtx = await browser.newContext();
        const bobPage = await bobCtx.newPage();
        await bobPage.goto(`/invite/${bobInviteToken}`);
        await bobPage.waitForLoadState("networkidle");
        await bobPage
            .getByRole("heading", { name: "Create your account" })
            .waitFor({ timeout: 5_000 });
        await bobPage.fill('input[placeholder="Jane Smith"]', "Bob Member");
        await bobPage.keyboard.press("Tab");
        await bobPage.fill('input[type="password"]', "BobPass99!");
        await bobPage.keyboard.press("Tab");
        await bobPage.getByRole("button", { name: "Create account & join" }).click();
        await bobPage.waitForURL(`**/${orgSlug}`, { timeout: 15_000 });
        await bobCtx.close();
    });

    test("invalid invite token shows error page", async ({ page }) => {
        await page.goto("/invite/invalid-token-xyz");
        await page.waitForLoadState("networkidle");
        await expect(
            page.getByRole("heading", { name: "Invitation not found" }),
        ).toBeVisible();
    });

    test("Bob is a member of the org after registering via invite link", async () => {
        const c = new Client({ connectionString: DB_URL });
        await c.connect();
        const { rows } = await c.query(
            `SELECT u.email
             FROM users u
             JOIN organization_members om ON om.user_id = u.id
             JOIN organizations o ON o.id = om.organization_id AND o.slug = 'invite-corp'
             WHERE u.email = 'bob@invite.test'`,
        );
        await c.end();
        expect(rows).toHaveLength(1);
    });

    test("Bob appears in Alice's team list", async ({ page }) => {
        await page.goto("/login");
        await page.waitForLoadState("networkidle");
        await page.fill('input[type="email"]', "alice@invite.test");
        await page.keyboard.press("Tab");
        await page.fill('input[type="password"]', "AlicePass99!");
        await page.keyboard.press("Tab");
        await page.click('button[type="submit"]');
        await page.waitForURL(`**/${orgSlug}`, { timeout: 15_000 });

        await page.goto(`/${orgSlug}/team`);
        await page.waitForLoadState("networkidle");
        await expect(page.getByText("Bob Member")).toBeVisible();
    });

    test("accepted invite token is no longer usable", async ({ page }) => {
        await page.goto(`/invite/${bobInviteToken}`);
        await page.waitForLoadState("networkidle");
        await expect(
            page.getByRole("heading", { name: "Invitation not found" }),
        ).toBeVisible();
    });

    test("Alice can revoke a pending invitation", async ({ page }) => {
        await page.goto("/login");
        await page.waitForLoadState("networkidle");
        await page.fill('input[type="email"]', "alice@invite.test");
        await page.keyboard.press("Tab");
        await page.fill('input[type="password"]', "AlicePass99!");
        await page.keyboard.press("Tab");
        await page.click('button[type="submit"]');
        await page.waitForURL(`**/${orgSlug}`, { timeout: 15_000 });

        await page.goto(`/${orgSlug}/team`);
        await page.waitForLoadState("networkidle");

        // Revoke Charlie's invitation
        const revokeBtn = page.getByRole("button", { name: "Revoke" }).first();
        await revokeBtn.waitFor({ timeout: 5_000 });
        await revokeBtn.click();

        // charlie@invite.test should disappear from the pending list
        await page.waitForFunction(
            () =>
                !Array.from(document.querySelectorAll("td")).some(
                    (td) => td.textContent === "charlie@invite.test",
                ),
            { timeout: 10_000 },
        );

        const c = new Client({ connectionString: DB_URL });
        await c.connect();
        const { rows } = await c.query(
            `SELECT id FROM invitations WHERE token = $1`,
            [charlieInviteToken],
        );
        await c.end();
        expect(rows).toHaveLength(0);
    });
});
