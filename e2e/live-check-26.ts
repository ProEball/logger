/**
 * Item 26 live check — run once, delete after passing.
 * Tests: logout → /login → enter creds → land on /[org].
 * Also covers proxy session guard and already-authed redirect from /login.
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
    await c.query("DELETE FROM users");
    await c.end();
    console.log("✓ DB cleaned");
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

    await setupPage.fill('input[placeholder="Acme Inc."]', "Logger Corp");
    await setupPage.keyboard.press("Tab");
    await setupPage.fill('input[placeholder="Jane Smith"]', "Alice Owner");
    await setupPage.keyboard.press("Tab");
    await setupPage.fill('input[placeholder="jane@example.com"]', "alice@logger.test");
    await setupPage.keyboard.press("Tab");
    await setupPage.fill('input[type="password"]', "SuperSecret99!");
    await setupPage.keyboard.press("Tab");
    await setupPage.click('button[type="submit"]');
    await setupPage.waitForURL("**/logger-corp", { timeout: 15_000 });
    console.log("✓ Setup complete, landed on", setupPage.url());
    await setupCtx.close();

    // ── Phase 2: Unauthenticated access → /login ───────────────────────────
    const anonCtx = await browser.newContext();
    const anonPage = await anonCtx.newPage();
    await anonPage.goto(BASE + "/logger-corp");
    await anonPage.waitForURL("**/login");
    console.log("✓ Unauthenticated /logger-corp → /login");
    await anonCtx.close();

    // ── Phase 3: Login ─────────────────────────────────────────────────────
    const authedCtx = await browser.newContext();
    const page = await authedCtx.newPage();
    await page.goto(BASE + "/login");
    await page.waitForLoadState("networkidle");

    await page.fill('input[type="email"]', "alice@logger.test");
    await page.keyboard.press("Tab");
    await page.fill('input[type="password"]', "SuperSecret99!");
    await page.keyboard.press("Tab");
    await page.click('button[type="submit"]');
    await page.waitForURL("**/logger-corp", { timeout: 15_000 });
    console.log("✓ Login → landed on", page.url());

    // ── Phase 4: Already authed hitting /login → redirect to / ─────────────
    await page.goto(BASE + "/login");
    await page.waitForURL("**/logger-corp", { timeout: 10_000 });
    console.log("✓ Authed /login → redirected to", page.url());

    // ── Phase 5: Logout ────────────────────────────────────────────────────
    await page.goto(BASE + "/logger-corp");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL("**/login", { timeout: 10_000 });
    console.log("✓ Logout → /login");

    // ── Phase 6: Re-login ──────────────────────────────────────────────────
    await page.waitForLoadState("networkidle");
    await page.fill('input[type="email"]', "alice@logger.test");
    await page.keyboard.press("Tab");
    await page.fill('input[type="password"]', "SuperSecret99!");
    await page.keyboard.press("Tab");
    await page.click('button[type="submit"]');
    await page.waitForURL("**/logger-corp", { timeout: 15_000 });
    console.log("✓ Re-login → landed on", page.url());

    // ── Phase 7: Wrong password → error shown ─────────────────────────────
    await page.goto(BASE + "/login");
    await page.waitForURL("**/logger-corp"); // authed, bounced back
    await authedCtx.close();

    const wrongCtx = await browser.newContext();
    const wrongPage = await wrongCtx.newPage();
    await wrongPage.goto(BASE + "/login");
    await wrongPage.waitForLoadState("networkidle");
    await wrongPage.fill('input[type="email"]', "alice@logger.test");
    await wrongPage.keyboard.press("Tab");
    await wrongPage.fill('input[type="password"]', "WrongPassword!");
    await wrongPage.keyboard.press("Tab");
    await wrongPage.click('button[type="submit"]');
    const errorEl = wrongPage.getByRole("alert");
    await errorEl.waitFor({ timeout: 5_000 });
    console.log("✓ Wrong password → error:", await errorEl.textContent());
    await wrongCtx.close();

    await browser.close();
    console.log("\n✅ Item 26 live check PASSED");
}

run().catch((err) => {
    console.error("\n❌ FAILED:", err.message);
    process.exit(1);
});
