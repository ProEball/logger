/**
 * Item 31 live check — run once, delete after passing.
 * Tests: request password reset → grab token from DB → set new password → login with new password.
 */
import { chromium } from "playwright";
import { Client } from "pg";

const BASE = "http://localhost:80";
const DB_URL = "postgresql://postgres:postgres@localhost:5432/logger";

async function cleanDb() {
    const c = new Client({ connectionString: DB_URL });
    await c.connect();
    await c.query("DELETE FROM organization_members");
    await c.query("DELETE FROM roles");
    await c.query("DELETE FROM organizations");
    await c.query("DELETE FROM accounts");
    await c.query("DELETE FROM sessions");
    await c.query("DELETE FROM verification_tokens");
    await c.query("DELETE FROM users");
    await c.end();
    console.log("✓ DB cleaned");
}

async function getResetToken(email: string): Promise<string> {
    const c = new Client({ connectionString: DB_URL });
    await c.connect();
    const result = await c.query(
        `SELECT identifier FROM verification_tokens
         WHERE identifier LIKE 'reset-password:%'
           AND value = (SELECT id FROM users WHERE email = $1)
         ORDER BY expires_at DESC
         LIMIT 1`,
        [email],
    );
    await c.end();
    if (!result.rows[0]) throw new Error("No reset token found in DB");
    const identifier: string = result.rows[0].identifier;
    return identifier.replace("reset-password:", "");
}

async function run() {
    await cleanDb();

    const browser = await chromium.launch({ headless: true });

    // ── Phase 1: Setup ─────────────────────────────────────────────────────
    const setupCtx = await browser.newContext();
    const setupPage = await setupCtx.newPage();
    await setupPage.goto(BASE + "/");
    await setupPage.waitForURL("**/setup");
    await setupPage.waitForLoadState("networkidle");

    await setupPage.fill('input[placeholder="Acme Inc."]', "Reset Corp");
    await setupPage.keyboard.press("Tab");
    await setupPage.fill('input[placeholder="Jane Smith"]', "Bob Reset");
    await setupPage.keyboard.press("Tab");
    await setupPage.fill('input[placeholder="jane@example.com"]', "bob@reset.test");
    await setupPage.keyboard.press("Tab");
    await setupPage.fill('input[type="password"]', "OldPass99!");
    await setupPage.keyboard.press("Tab");
    await setupPage.click('button[type="submit"]');
    await setupPage.waitForURL("**/reset-corp", { timeout: 15_000 });
    console.log("✓ Setup complete, landed on", setupPage.url());
    await setupCtx.close();

    // ── Phase 2: Request password reset ───────────────────────────────────
    const anonCtx = await browser.newContext();
    const anonPage = await anonCtx.newPage();
    await anonPage.goto(BASE + "/forgot-password");
    await anonPage.waitForLoadState("networkidle");

    await anonPage.fill('input[type="email"]', "bob@reset.test");
    await anonPage.keyboard.press("Tab");
    await anonPage.click('button[type="submit"]');

    // Wait for success state (form replaced by "Check your email" heading)
    await anonPage.getByRole("heading", { name: "Check your email" }).waitFor({ timeout: 10_000 });
    console.log("✓ Forgot-password form submitted, success state shown");
    await anonCtx.close();

    // ── Phase 3: Grab token from DB ────────────────────────────────────────
    const token = await getResetToken("bob@reset.test");
    const resetUrl = `${BASE}/reset-password/${token}`;
    console.log("✓ Reset token retrieved:", token.slice(0, 6) + "…");

    // ── Phase 4: Set new password ──────────────────────────────────────────
    const resetCtx = await browser.newContext();
    const resetPage = await resetCtx.newPage();
    await resetPage.goto(resetUrl);
    await resetPage.waitForLoadState("networkidle");

    const passwordInputs = resetPage.locator('input[type="password"]');
    await passwordInputs.nth(0).fill("NewPass99!");
    await resetPage.keyboard.press("Tab");
    await passwordInputs.nth(1).fill("NewPass99!");
    await resetPage.keyboard.press("Tab");
    await resetPage.click('button[type="submit"]');
    await resetPage.waitForURL("**/login", { timeout: 10_000 });
    console.log("✓ New password set, redirected to /login");
    await resetCtx.close();

    // ── Phase 5: Login with new password ──────────────────────────────────
    const loginCtx = await browser.newContext();
    const loginPage = await loginCtx.newPage();
    await loginPage.goto(BASE + "/login");
    await loginPage.waitForLoadState("networkidle");

    await loginPage.fill('input[type="email"]', "bob@reset.test");
    await loginPage.keyboard.press("Tab");
    await loginPage.fill('input[type="password"]', "NewPass99!");
    await loginPage.keyboard.press("Tab");
    await loginPage.click('button[type="submit"]');
    await loginPage.waitForURL("**/reset-corp", { timeout: 15_000 });
    console.log("✓ Login with new password → landed on", loginPage.url());
    await loginCtx.close();

    // ── Phase 6: Old password no longer works ─────────────────────────────
    const oldCtx = await browser.newContext();
    const oldPage = await oldCtx.newPage();
    await oldPage.goto(BASE + "/login");
    await oldPage.waitForLoadState("networkidle");

    await oldPage.fill('input[type="email"]', "bob@reset.test");
    await oldPage.keyboard.press("Tab");
    await oldPage.fill('input[type="password"]', "OldPass99!");
    await oldPage.keyboard.press("Tab");
    await oldPage.click('button[type="submit"]');
    const errorEl = oldPage.getByRole("alert");
    await errorEl.waitFor({ timeout: 5_000 });
    console.log("✓ Old password rejected:", await errorEl.textContent());
    await oldCtx.close();

    await browser.close();
    console.log("\n✅ Item 31 live check PASSED");
}

run().catch((err) => {
    console.error("\n❌ FAILED:", err.message);
    process.exit(1);
});
