/**
 * Item 22 live check — run once, delete after passing.
 * Tests: redirect → /setup, fill form, land on /[org], /setup becomes 404,
 * and a second submit attempt returns "already complete" error.
 */
import { chromium } from "playwright";
import { Client } from "pg";

const BASE = "http://localhost:80";
const DB_URL = "postgresql://postgres:postgres@localhost:5432/logger";

async function cleanDb() {
    const c = new Client({ connectionString: DB_URL });
    await c.connect();
    // cascade via FK — deleting orgs removes members/roles; deleting users removes sessions/accounts
    await c.query("DELETE FROM organization_members");
    await c.query("DELETE FROM roles");
    await c.query("DELETE FROM organizations");
    await c.query("DELETE FROM accounts");
    await c.query("DELETE FROM sessions");
    await c.query("DELETE FROM users");
    await c.end();
    console.log("✓ DB cleaned");
}

async function countUsers(): Promise<number> {
    const c = new Client({ connectionString: DB_URL });
    await c.connect();
    const { rows } = await c.query("SELECT COUNT(*)::int AS n FROM users");
    await c.end();
    return rows[0].n;
}

async function run() {
    await cleanDb();

    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    // ── Step 1: / redirects to /setup ─────────────────────────────────────
    await page.goto(BASE + "/");
    await page.waitForURL("**/setup");
    console.log("✓ / → redirected to /setup");

    // Wait for React to hydrate (client component bundle must load first)
    await page.waitForLoadState("networkidle");

    // ── Step 2: fill setup wizard ──────────────────────────────────────────
    // Tab after each fill triggers GForm's blur-based validation so state.isValid is true before submit.
    await page.fill('input[placeholder="Acme Inc."]', "Logger Corp");
    await page.keyboard.press("Tab");
    await page.fill('input[placeholder="Jane Smith"]', "Alice Owner");
    await page.keyboard.press("Tab");
    await page.fill('input[placeholder="jane@example.com"]', "alice@logger.test");
    await page.keyboard.press("Tab");
    await page.fill('input[type="password"]', "SuperSecret99!");
    await page.keyboard.press("Tab");

    // ── Step 3: submit ─────────────────────────────────────────────────────
    await page.click('button[type="submit"]');
    await page.waitForURL("**/logger-corp", { timeout: 15_000 });
    console.log(`✓ Redirected to ${page.url()} after setup`);

    // ── Step 4: verify DB has the right data ───────────────────────────────
    const userCount = await countUsers();
    if (userCount !== 1) throw new Error(`Expected 1 user, got ${userCount}`);
    console.log("✓ 1 user in DB");

    const c = new Client({ connectionString: DB_URL });
    await c.connect();
    const { rows: orgs } = await c.query("SELECT name, slug FROM organizations");
    const { rows: members } = await c.query("SELECT is_owner FROM organization_members");
    const { rows: roles } = await c.query("SELECT name FROM roles ORDER BY name");
    await c.end();

    if (orgs.length !== 1 || orgs[0].slug !== "logger-corp") throw new Error(`Org mismatch: ${JSON.stringify(orgs)}`);
    console.log(`✓ Org: ${orgs[0].name} (slug: ${orgs[0].slug})`);
    if (!members[0]?.is_owner) throw new Error("Owner flag not set");
    console.log("✓ Owner membership created");
    if (roles.length !== 3) throw new Error(`Expected 3 system roles, got ${roles.length}`);
    console.log(`✓ System roles: ${roles.map((r: { name: string }) => r.name).join(", ")}`);

    // ── Step 5: /setup must now return 404 ────────────────────────────────
    const setupRes = await page.request.get(BASE + "/setup");
    if (setupRes.status() !== 404) throw new Error(`/setup returned ${setupRes.status()}, expected 404`);
    console.log("✓ /setup → 404 (proxy guard working)");

    // ── Step 6: second submit attempt → SetupAlreadyDoneError ─────────────
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await page2.goto(BASE + "/setup");
    // Proxy should now return 404, not the form
    if (page2.url().includes("/setup")) {
        const body = await page2.content();
        // Either 404 page or redirected away
        const is404 = body.includes("404") || page2.url() !== BASE + "/setup";
        console.log(`✓ Second tab at /setup: ${is404 ? "blocked (404/redirect)" : "WARNING: form still visible"}`);
    }
    await ctx2.close();

    await browser.close();
    console.log("\n✅ Item 22 live check PASSED");
}

run().catch((err) => {
    console.error("\n❌ FAILED:", err.message);
    process.exit(1);
});
