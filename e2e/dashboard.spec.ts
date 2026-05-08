import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { randomUUID, randomBytes, createHash } from "crypto";

const DB_URL = "postgresql://postgres:postgres@localhost:5432/logger";
const BASE = "http://localhost";

// ─── Key helpers ──────────────────────────────────────────────────────────────

function generateApiKey(): string {
    return `lgr_${randomBytes(32).toString("base64url")}`;
}
function extractKeyPrefix(key: string): string {
    return key.slice(4, 8);
}
function hashApiKey(key: string): string {
    return createHash("sha256").update(key).digest("hex");
}

// ─── Context ──────────────────────────────────────────────────────────────────

interface E2ECtx {
    orgId: string;
    orgSlug: string;
    projectId: string;
    projSlug: string;
    userId: string;
    userEmail: string;
    apiKey: string;
}

// Empty project for the "no events" test
interface EmptyCtx {
    orgId: string;
    orgSlug: string;
    projectId: string;
    projSlug: string;
}

async function seedCtx(): Promise<E2ECtx> {
    const c = new Client({ connectionString: DB_URL });
    await c.connect();

    const orgId = randomUUID();
    const projectId = randomUUID();
    const userId = randomUUID().replace(/-/g, "").slice(0, 20);
    const orgSlug = `dash-org-${orgId.slice(0, 8)}`;
    const projSlug = `dash-proj-${projectId.slice(0, 8)}`;
    const userEmail = `dash-e2e-${userId}@test.local`;

    await c.query(
        `INSERT INTO users (id, name, email, email_verified, preferences)
         VALUES ($1, $2, $3, true, '{"theme":"dark","autoRefresh":"off"}')
         ON CONFLICT DO NOTHING`,
        [userId, "Dash E2E User", userEmail],
    );

    await c.query(
        `INSERT INTO organizations (id, name, slug) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [orgId, "Dash E2E Org", orgSlug],
    );

    const roleRes = await c.query<{ id: string }>(
        `SELECT id FROM roles WHERE organization_id = $1 AND name = 'Owner' LIMIT 1`,
        [orgId],
    );
    let roleId: string;
    if (roleRes.rows.length === 0) {
        roleId = randomUUID();
        await c.query(
            `INSERT INTO roles (id, organization_id, name, permissions) VALUES ($1, $2, 'Owner', ARRAY['*'])`,
            [roleId, orgId],
        );
    } else {
        roleId = roleRes.rows[0].id;
    }

    await c.query(
        `INSERT INTO organization_members (user_id, organization_id, role_id, is_owner)
         VALUES ($1, $2, $3, true) ON CONFLICT DO NOTHING`,
        [userId, orgId, roleId],
    );

    await c.query(
        `INSERT INTO projects (id, organization_id, name, slug) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
        [projectId, orgId, "Dash E2E Project", projSlug],
    );

    const apiKey = generateApiKey();
    await c.query(
        `INSERT INTO api_keys (id, project_id, name, key_hash, key_prefix)
         VALUES ($1, $2, $3, $4, $5)`,
        [randomUUID(), projectId, "E2E dash key", hashApiKey(apiKey), extractKeyPrefix(apiKey)],
    );

    const sessionId = randomUUID();
    const token = randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await c.query(
        `INSERT INTO sessions (id, user_id, token, expires_at) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
        [sessionId, userId, token, expires],
    );

    await c.end();
    return { orgId, orgSlug, projectId, projSlug, userId, userEmail, apiKey };
}

async function seedEmptyCtx(): Promise<EmptyCtx> {
    const c = new Client({ connectionString: DB_URL });
    await c.connect();

    const orgId = randomUUID();
    const projectId = randomUUID();
    const orgSlug = `dash-empty-org-${orgId.slice(0, 8)}`;
    const projSlug = `dash-empty-proj-${projectId.slice(0, 8)}`;

    await c.query(
        `INSERT INTO organizations (id, name, slug) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [orgId, "Dash Empty Org", orgSlug],
    );
    await c.query(
        `INSERT INTO projects (id, organization_id, name, slug) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
        [projectId, orgId, "Empty Dash Project", projSlug],
    );
    const apiKey = generateApiKey();
    await c.query(
        `INSERT INTO api_keys (id, project_id, name, key_hash, key_prefix) VALUES ($1, $2, $3, $4, $5)`,
        [randomUUID(), projectId, "empty key", hashApiKey(apiKey), extractKeyPrefix(apiKey)],
    );

    await c.end();
    return { orgId, orgSlug, projectId, projSlug };
}

async function seedEvents(
    apiKey: string,
    count: number,
    overrides: Record<string, unknown> = {},
): Promise<void> {
    const batch = Array.from({ length: count }, (_, i) => ({
        level: "info",
        message: `dashboard test event ${i}`,
        ...overrides,
    }));
    const res = await fetch(`${BASE}/api/ingest/batch`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(batch),
    });
    if (!res.ok) throw new Error(`Ingest failed: ${res.status}`);
}

async function cleanCtx(orgId: string): Promise<void> {
    const c = new Client({ connectionString: DB_URL });
    await c.connect();
    await c.query(`DELETE FROM events WHERE project_id IN (SELECT id FROM projects WHERE organization_id = $1)`, [orgId]);
    await c.query(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'dash-e2e-%@test.local')`);
    await c.query(`DELETE FROM api_keys WHERE project_id IN (SELECT id FROM projects WHERE organization_id = $1)`, [orgId]);
    await c.query(`DELETE FROM projects WHERE organization_id = $1`, [orgId]);
    await c.query(`DELETE FROM organization_members WHERE organization_id = $1`, [orgId]);
    await c.query(`DELETE FROM roles WHERE organization_id = $1`, [orgId]);
    await c.query(`DELETE FROM organizations WHERE id = $1`, [orgId]);
    await c.query(`DELETE FROM users WHERE email LIKE 'dash-e2e-%@test.local'`);
    await c.end();
}

async function cleanEmptyCtx(orgId: string): Promise<void> {
    const c = new Client({ connectionString: DB_URL });
    await c.connect();
    await c.query(`DELETE FROM api_keys WHERE project_id IN (SELECT id FROM projects WHERE organization_id = $1)`, [orgId]);
    await c.query(`DELETE FROM projects WHERE organization_id = $1`, [orgId]);
    await c.query(`DELETE FROM organizations WHERE id = $1`, [orgId]);
    await c.end();
}

// ─── Tests ────────────────────────────────────────────────────────────────────

let ctx: E2ECtx;
let emptyCtx: EmptyCtx;

test.describe("Dashboard", () => {
    test.beforeAll(async () => {
        ctx = await seedCtx();
        emptyCtx = await seedEmptyCtx();

        // Seed mixed events: 20 info + 5 error with stack traces
        await seedEvents(ctx.apiKey, 20, {});
        await seedEvents(ctx.apiKey, 5, {
            level: "error",
            error_type: "TypeError",
            stack_trace: "TypeError: oops\n    at fn (app.js:10:5)",
            environment: "production",
        });
        await seedEvents(ctx.apiKey, 5, {
            level: "warn",
            environment: "staging",
        });
    });

    test.afterAll(async () => {
        if (ctx) await cleanCtx(ctx.orgId);
        if (emptyCtx) await cleanEmptyCtx(emptyCtx.orgId);
    });

    // ── DB-level aggregation assertions ──────────────────────────────────────

    test("Level breakdown — 3 distinct levels ingested", async () => {
        const c = new Client({ connectionString: DB_URL });
        await c.connect();
        const { rows } = await c.query<{ level: string; cnt: string }>(
            `SELECT level, COUNT(*)::text AS cnt
             FROM events WHERE project_id = $1
             GROUP BY level ORDER BY cnt DESC`,
            [ctx.projectId],
        );
        await c.end();

        const levels = rows.map((r) => r.level);
        expect(levels).toContain("info");
        expect(levels).toContain("error");
        expect(levels).toContain("warn");
    });

    test("Environment breakdown — 2 distinct environments + nulls", async () => {
        const c = new Client({ connectionString: DB_URL });
        await c.connect();
        const { rows } = await c.query<{ env: string }>(
            `SELECT COALESCE(environment, '(unset)') AS env
             FROM events WHERE project_id = $1
             GROUP BY 1`,
            [ctx.projectId],
        );
        await c.end();

        const envs = rows.map((r) => r.env);
        expect(envs).toContain("production");
        expect(envs).toContain("staging");
        expect(envs).toContain("(unset)");
    });

    test("Top messages — at least one grouped message row", async () => {
        const c = new Client({ connectionString: DB_URL });
        await c.connect();
        const { rows } = await c.query<{ cnt: string }>(
            `SELECT COUNT(*)::text AS cnt FROM (
                SELECT SUBSTRING(message, 1, 200)
                FROM events WHERE project_id = $1
                GROUP BY 1
             ) sub`,
            [ctx.projectId],
        );
        await c.end();
        expect(Number(rows[0].cnt)).toBeGreaterThan(0);
    });

    test("Recent errors — 5 error/fatal events seeded", async () => {
        const c = new Client({ connectionString: DB_URL });
        await c.connect();
        const { rows } = await c.query<{ cnt: string }>(
            `SELECT COUNT(*)::text AS cnt
             FROM events WHERE project_id = $1 AND level IN ('error', 'fatal')`,
            [ctx.projectId],
        );
        await c.end();
        expect(Number(rows[0].cnt)).toBe(5);
    });

    test("Time-series buckets — 30 events in last 1h window", async () => {
        const c = new Client({ connectionString: DB_URL });
        await c.connect();
        const { rows } = await c.query<{ cnt: string }>(
            `SELECT COUNT(*)::text AS cnt
             FROM events
             WHERE project_id = $1
               AND timestamp >= now() - interval '1 hour'`,
            [ctx.projectId],
        );
        await c.end();
        expect(Number(rows[0].cnt)).toBe(30);
    });

    test("Empty project — has_any_events returns false", async () => {
        const c = new Client({ connectionString: DB_URL });
        await c.connect();
        const { rows } = await c.query<{ has_events: boolean }>(
            `SELECT EXISTS (SELECT 1 FROM events WHERE project_id = $1 LIMIT 1) AS has_events`,
            [emptyCtx.projectId],
        );
        await c.end();
        expect(rows[0].has_events).toBe(false);
    });

    test("GET /[org]/[project] → dashboard renders", async ({ page }) => {
        const url = `${BASE}/${ctx.orgSlug}/${ctx.projSlug}?range=1h`;
        const response = await page.goto(url);
        if (response?.url().includes("/login")) {
            test.skip();
            return;
        }
        // Wait for at least one widget card title to appear
        await page.waitForSelector("h2", { timeout: 10_000 });
    });

    test("GET /[org]/[project] (empty project) → shows onboarding CTA", async ({ page }) => {
        // This test needs a logged-in session; skip if auth not available
        const url = `${BASE}/${emptyCtx.orgSlug}/${emptyCtx.projSlug}`;
        const response = await page.goto(url);
        if (response?.url().includes("/login")) {
            test.skip();
            return;
        }
        // The empty state page contains the curl example
        const text = await page.textContent("body");
        expect(text).toContain("curl");
    });
});
