/**
 * Item 40 live check — run once, delete after passing.
 * Tests: create invite → register via link → land in org with assigned role → revoke invite.
 */
import { chromium } from "playwright";
import { Client } from "pg";

const BASE = "http://localhost:80";
const DB_URL = "postgresql://postgres:postgres@localhost:5432/logger";

async function cleanDb() {
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
    console.log("✓ DB cleaned");
}

async function getInviteToken(email: string): Promise<string> {
    const c = new Client({ connectionString: DB_URL });
    await c.connect();
    const res = await c.query(
        `SELECT token FROM invitations WHERE email = $1
         AND accepted_at IS NULL ORDER BY created_at DESC LIMIT 1`,
        [email],
    );
    await c.end();
    if (!res.rows[0]) throw new Error(`No pending invite found for ${email}`);
    return res.rows[0].token as string;
}

async function run() {
    await cleanDb();

    const browser = await chromium.launch({ headless: true });

    // ── Phase 1: Setup as Alice ────────────────────────────────────────────
    const setupCtx = await browser.newContext();
    const setupPage = await setupCtx.newPage();
    await setupPage.goto(BASE + "/");
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
    console.log("✓ Setup complete, landed on", setupPage.url());

    // ── Phase 2: Navigate to team page ────────────────────────────────────
    await setupPage.goto(BASE + "/invite-corp/team");
    await setupPage.waitForLoadState("networkidle");
    await setupPage.getByRole("heading", { name: "Team" }).waitFor({ timeout: 5_000 });
    console.log("✓ Team page loaded");

    // ── Phase 3: Open invite dialog ────────────────────────────────────────
    await setupPage.getByRole("button", { name: "Invite member" }).click();
    await setupPage.getByRole("dialog").waitFor({ timeout: 5_000 });
    console.log("✓ Invite dialog opened");

    await setupPage.fill('input[type="email"]', "bob@invite.test");
    await setupPage.keyboard.press("Tab");
    // Role select stays at default (first role)
    await setupPage.getByRole("button", { name: "Send invitation" }).click();

    // Invitation created dialog
    await setupPage.getByRole("heading", { name: "Invitation created" }).waitFor({ timeout: 10_000 });
    console.log("✓ InvitationCreatedDialog shown");

    await setupPage.getByRole("button", { name: "Done" }).click();
    await setupCtx.close();

    // ── Phase 4: Get invite token from DB ─────────────────────────────────
    const token = await getInviteToken("bob@invite.test");
    const inviteUrl = `${BASE}/invite/${token}`;
    console.log("✓ Invite token from DB:", token.slice(0, 8) + "…");

    // ── Phase 5: Bob registers via invite link ────────────────────────────
    const bobCtx = await browser.newContext();
    const bobPage = await bobCtx.newPage();
    await bobPage.goto(inviteUrl);
    await bobPage.waitForLoadState("networkidle");

    // Should show registration form (AcceptInviteForm)
    await bobPage.getByRole("heading", { name: "Create your account" }).waitFor({ timeout: 5_000 });
    console.log("✓ Registration form shown for Bob");

    await bobPage.fill('input[placeholder="Jane Smith"]', "Bob Member");
    await bobPage.keyboard.press("Tab");
    await bobPage.fill('input[type="password"]', "BobPass99!");
    await bobPage.keyboard.press("Tab");
    await bobPage.getByRole("button", { name: "Create account & join" }).click();
    await bobPage.waitForURL("**/invite-corp", { timeout: 15_000 });
    console.log("✓ Bob registered and landed on", bobPage.url());
    await bobCtx.close();

    // ── Phase 6: Verify Bob is in member list (as Alice) ──────────────────
    const aliceCtx = await browser.newContext();
    const alicePage = await aliceCtx.newPage();
    await alicePage.goto(BASE + "/login");
    await alicePage.waitForLoadState("networkidle");
    await alicePage.fill('input[type="email"]', "alice@invite.test");
    await alicePage.keyboard.press("Tab");
    await alicePage.fill('input[type="password"]', "AlicePass99!");
    await alicePage.keyboard.press("Tab");
    await alicePage.click('button[type="submit"]');
    await alicePage.waitForURL("**/invite-corp", { timeout: 15_000 });

    await alicePage.goto(BASE + "/invite-corp/team");
    await alicePage.waitForLoadState("networkidle");
    await alicePage.getByText("Bob Member").waitFor({ timeout: 5_000 });
    console.log("✓ Bob Member appears in team list");

    // ── Phase 7: Invite Charlie, then revoke ──────────────────────────────
    await alicePage.getByRole("button", { name: "Invite member" }).click();
    await alicePage.getByRole("dialog").waitFor({ timeout: 5_000 });
    await alicePage.fill('input[type="email"]', "charlie@invite.test");
    await alicePage.keyboard.press("Tab");
    await alicePage.getByRole("button", { name: "Send invitation" }).click();
    await alicePage.getByRole("heading", { name: "Invitation created" }).waitFor({ timeout: 10_000 });
    await alicePage.getByRole("button", { name: "Done" }).click();
    console.log("✓ Charlie invitation created");

    // Revoke Charlie's invitation
    await alicePage.waitForLoadState("networkidle");
    const revokeBtn = alicePage.getByRole("button", { name: "Revoke" }).first();
    await revokeBtn.waitFor({ timeout: 5_000 });
    await revokeBtn.click();
    // Wait for the server action + revalidatePath to re-render the page
    await alicePage.waitForFunction(() => !document.querySelector("td") ||
        !Array.from(document.querySelectorAll("td")).some(td => td.textContent === "charlie@invite.test"),
        { timeout: 10_000 },
    );
    console.log("✓ Charlie invite revoked: removed from list");

    // ── Phase 8: Expired/invalid invite link shows error ──────────────────
    const badCtx = await browser.newContext();
    const badPage = await badCtx.newPage();
    await badPage.goto(BASE + "/invite/invalid-token-xyz");
    await badPage.waitForLoadState("networkidle");
    await badPage.getByRole("heading", { name: "Invitation not found" }).waitFor({ timeout: 5_000 });
    console.log("✓ Invalid token → 'Invitation not found' shown");
    await badCtx.close();

    await aliceCtx.close();
    await browser.close();
    console.log("\n✅ Item 40 live check PASSED");
}

run().catch((err) => {
    console.error("\n❌ FAILED:", err.message);
    process.exit(1);
});
