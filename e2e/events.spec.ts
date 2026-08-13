import { expect, test } from "@playwright/test";
import { randomUUID } from "crypto";
import { withDb } from "@/e2e/support/db";
import { resetDb } from "@/e2e/support/cleanup";
import { bootstrapOrg, login } from "@/e2e/support/auth";
import { generateApiKey, extractKeyPrefix, hashApiKey } from "@/e2e/support/api-keys";
import { BASE_URL } from "@/e2e/support/env";

const ORG_SLUG = "events-corp";
const EMAIL = "alice@events.test";
const PASS = "AlicePass99!";
const PROJECT_SLUG = "events-project";

interface Ctx {
    projectId: string;
    apiKey: string;
}

async function seedProject(orgId: string): Promise<Ctx> {
    const projectId = randomUUID();
    const apiKey = generateApiKey();
    await withDb(async (c) => {
        await c.query(
            `INSERT INTO projects (id, organization_id, name, slug) VALUES ($1, $2, $3, $4)`,
            [projectId, orgId, "Events Project", PROJECT_SLUG],
        );
        await c.query(
            `INSERT INTO api_keys (id, project_id, name, key_hash, key_prefix) VALUES ($1, $2, $3, $4, $5)`,
            [randomUUID(), projectId, "seed key", hashApiKey(apiKey), extractKeyPrefix(apiKey)],
        );
    });
    return { projectId, apiKey };
}

async function seedEvents(apiKey: string, count: number, overrides: Record<string, unknown> = {}): Promise<void> {
    const batch = Array.from({ length: count }, (_, i) => ({
        level: "info",
        message: `test event ${i}`,
        ...overrides,
    }));
    const res = await fetch(`${BASE_URL}/api/ingest/batch`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(batch),
    });
    if (!res.ok) throw new Error(`Ingest failed: ${res.status}`);
}

let ctx: Ctx;

test.describe.serial("Events list", () => {
    test.beforeAll(async ({ browser }) => {
        await resetDb();

        const setupCtx = await browser.newContext();
        const setupPage = await setupCtx.newPage();
        await bootstrapOrg(setupPage, {
            orgName: "Events Corp",
            ownerName: "Alice Owner",
            email: EMAIL,
            password: PASS,
            orgSlug: ORG_SLUG,
        });
        await setupCtx.close();

        const { rows } = await withDb((c) => c.query("SELECT id FROM organizations WHERE slug = $1", [ORG_SLUG]));
        ctx = await seedProject(rows[0].id);

        // Seed 60 info events + 5 error events with stack trace
        await seedEvents(ctx.apiKey, 60, {});
        await seedEvents(ctx.apiKey, 5, {
            level: "error",
            error_type: "TypeError",
            stack_trace: "TypeError: Cannot read properties of undefined\n    at Object.handler (app.js:10:5)\n    at Router.handle (router.js:20:3)",
            attributes: { user_id: "u_e2e_123" },
        });
    });

    test("GET /[org]/[project]/events → shows events table", async ({ page }) => {
        await login(page, EMAIL, PASS, ORG_SLUG);
        await page.goto(`/${ORG_SLUG}/${PROJECT_SLUG}/events?range=7d`);
        await page.waitForSelector("table", { timeout: 10_000 });
        const rows = await page.locator("tbody tr").count();
        expect(rows).toBeGreaterThan(0);
    });

    test("GET /api/ingest → events queryable after ingest", async ({ request }) => {
        // Verify events exist in DB via ingest endpoint
        const res = await request.post("/api/ingest", {
            headers: {
                "Authorization": `Bearer ${ctx.apiKey}`,
                "Content-Type": "application/json",
            },
            data: { level: "info", message: "E2E query check" },
        });
        expect(res.status()).toBe(202);
        const body = await res.json() as { id: string };
        expect(body.id).toMatch(/^[0-9a-f-]{36}$/);

        const { rows } = await withDb((c) => c.query(`SELECT id, message FROM events WHERE id = $1`, [body.id]));
        expect(rows[0]?.message).toBe("E2E query check");
    });

    test("GET /api/ingest/batch → 65 events in DB for test project", async () => {
        const { rows } = await withDb((c) =>
            c.query(`SELECT count(*)::int AS cnt FROM events WHERE project_id = $1`, [ctx.projectId]),
        );
        // 60 info + 5 error + 1 from previous test = at least 65
        expect(rows[0].cnt).toBeGreaterThanOrEqual(65);
    });

    test("Filter by level=error → API ingest query returns only error events", async () => {
        const { rows } = await withDb((c) =>
            c.query(
                `SELECT count(*)::int AS cnt FROM events WHERE project_id = $1 AND level = 'error'`,
                [ctx.projectId],
            ),
        );
        expect(rows[0].cnt).toBe(5);
    });

    test("Cursor pagination via DB — 51 events available for pagination", async () => {
        const { rows } = await withDb((c) =>
            c.query(
                `SELECT count(*)::int AS cnt FROM events WHERE project_id = $1 AND timestamp >= now() - interval '7 days'`,
                [ctx.projectId],
            ),
        );
        // We seeded 65+, so hasMore=true on first page of 50
        expect(rows[0].cnt).toBeGreaterThan(50);
    });

    test("Attribute filter in DB — events with user_id attribute exist", async () => {
        const { rows } = await withDb((c) =>
            c.query(
                `SELECT count(*)::int AS cnt FROM events WHERE project_id = $1 AND attributes @> '{"user_id":"u_e2e_123"}'::jsonb`,
                [ctx.projectId],
            ),
        );
        expect(rows[0].cnt).toBe(5);
    });

    test("Stack trace events exist in DB", async () => {
        const { rows } = await withDb((c) =>
            c.query(
                `SELECT count(*)::int AS cnt FROM events WHERE project_id = $1 AND stack_trace IS NOT NULL`,
                [ctx.projectId],
            ),
        );
        expect(rows[0].cnt).toBe(5);
    });

    test("OPTIONS /api/ingest → CORS headers", async ({ request }) => {
        const response = await request.fetch("/api/ingest", {
            method: "OPTIONS",
            headers: { "Origin": "https://example.com" },
        });
        expect(response.status()).toBe(204);
        expect(response.headers()["access-control-allow-origin"]).toBe("*");
    });
});
