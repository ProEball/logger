import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { randomUUID, randomBytes, createHash } from "crypto";

const DB_URL = "postgresql://postgres:postgres@localhost:5432/logger";
const BASE = "http://localhost";

// Inline key generation (mirrors features/api-keys/utils/*)
function generateApiKey(): string {
    const bytes = randomBytes(32);
    const b64 = bytes.toString("base64url");
    return `lgr_${b64}`;
}
function extractKeyPrefix(key: string): string {
    return key.slice(4, 8);
}
function hashApiKey(key: string): string {
    return createHash("sha256").update(key).digest("hex");
}

interface TestContext {
    orgId: string;
    projectId: string;
    apiKey: string;
}

async function seedTestContext(): Promise<TestContext> {
    const c = new Client({ connectionString: DB_URL });
    await c.connect();

    const orgId = randomUUID();
    const projectId = randomUUID();
    const orgSlug = `ingest-org-${orgId.slice(0, 8)}`;
    const projSlug = `ingest-proj-${projectId.slice(0, 8)}`;

    await c.query(
        `INSERT INTO organizations (id, name, slug) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [orgId, "Ingest Test Org", orgSlug],
    );
    await c.query(
        `INSERT INTO projects (id, organization_id, name, slug) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
        [projectId, orgId, "Ingest Test Project", projSlug],
    );

    const plainKey = generateApiKey();
    await c.query(
        `INSERT INTO api_keys (id, project_id, name, key_hash, key_prefix) VALUES ($1, $2, $3, $4, $5)`,
        [randomUUID(), projectId, "E2E test key", hashApiKey(plainKey), extractKeyPrefix(plainKey)],
    );

    await c.end();
    return { orgId, projectId, apiKey: plainKey };
}

async function cleanTestContext(orgId: string): Promise<void> {
    const c = new Client({ connectionString: DB_URL });
    await c.connect();
    await c.query(
        `DELETE FROM events WHERE project_id IN (SELECT id FROM projects WHERE organization_id = $1)`,
        [orgId],
    );
    await c.query(
        `DELETE FROM api_keys WHERE project_id IN (SELECT id FROM projects WHERE organization_id = $1)`,
        [orgId],
    );
    await c.query(`DELETE FROM projects WHERE organization_id = $1`, [orgId]);
    await c.query(`DELETE FROM organizations WHERE id = $1`, [orgId]);
    await c.end();
}

let ctx: TestContext;

test.describe("Ingest API", () => {
    test.beforeAll(async () => {
        ctx = await seedTestContext();
    });

    test.afterAll(async () => {
        if (ctx) await cleanTestContext(ctx.orgId);
    });

    test("POST /api/ingest with valid key → 202 + id", async ({ request }) => {
        const response = await request.post(`${BASE}/api/ingest`, {
            headers: {
                "Authorization": `Bearer ${ctx.apiKey}`,
                "Content-Type": "application/json",
            },
            data: { level: "info", message: "e2e test event" },
        });
        expect(response.status()).toBe(202);
        const body = await response.json() as { id: string };
        expect(body.id).toMatch(/^[0-9a-f-]{36}$/);

        // Verify row in DB
        const c = new Client({ connectionString: DB_URL });
        await c.connect();
        const { rows } = await c.query(`SELECT id, message FROM events WHERE id = $1`, [body.id]);
        await c.end();
        expect(rows[0]?.message).toBe("e2e test event");
    });

    test("POST /api/ingest/batch with 100 events → 202 + accepted: 100", async ({ request }) => {
        const events = Array.from({ length: 100 }, (_, i) => ({
            level: "debug",
            message: `batch event ${i}`,
        }));
        const response = await request.post(`${BASE}/api/ingest/batch`, {
            headers: {
                "Authorization": `Bearer ${ctx.apiKey}`,
                "Content-Type": "application/json",
            },
            data: events,
        });
        expect(response.status()).toBe(202);
        const body = await response.json() as { accepted: number; errors: unknown[] };
        expect(body.accepted).toBe(100);
        expect(body.errors).toHaveLength(0);
    });

    test("POST /api/ingest with wrong key format → 401", async ({ request }) => {
        const response = await request.post(`${BASE}/api/ingest`, {
            headers: {
                "Authorization": "Bearer totally_wrong_key",
                "Content-Type": "application/json",
            },
            data: { level: "info", message: "fail" },
        });
        expect(response.status()).toBe(401);
    });

    test("POST /api/ingest with past timestamp (>30 days) → 400", async ({ request }) => {
        const oldTs = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
        const response = await request.post(`${BASE}/api/ingest`, {
            headers: {
                "Authorization": `Bearer ${ctx.apiKey}`,
                "Content-Type": "application/json",
            },
            data: { level: "info", message: "old event", timestamp: oldTs },
        });
        expect(response.status()).toBe(400);
    });

    test("POST /api/ingest with malformed JSON → 400", async ({ request }) => {
        const response = await request.post(`${BASE}/api/ingest`, {
            headers: {
                "Authorization": `Bearer ${ctx.apiKey}`,
                "Content-Type": "application/json",
            },
            data: "not json at all{{{",
        });
        expect(response.status()).toBe(400);
    });

    test("OPTIONS /api/ingest → 204 with CORS headers", async ({ request }) => {
        const response = await request.fetch(`${BASE}/api/ingest`, {
            method: "OPTIONS",
            headers: { "Origin": "https://example.com" },
        });
        expect(response.status()).toBe(204);
        expect(response.headers()["access-control-allow-origin"]).toBe("*");
    });

    test("POST /api/ingest with revoked key → 401", async ({ request }) => {
        // Create a separate key just for this test and immediately revoke it
        const revokeKey = generateApiKey();
        const c = new Client({ connectionString: DB_URL });
        await c.connect();
        await c.query(
            `INSERT INTO api_keys (id, project_id, name, key_hash, key_prefix, revoked_at)
             VALUES ($1, $2, $3, $4, $5, now())`,
            [randomUUID(), ctx.projectId, "revoked key", hashApiKey(revokeKey), extractKeyPrefix(revokeKey)],
        );
        await c.end();

        const response = await request.post(`${BASE}/api/ingest`, {
            headers: {
                "Authorization": `Bearer ${revokeKey}`,
                "Content-Type": "application/json",
            },
            data: { level: "info", message: "should fail" },
        });
        expect(response.status()).toBe(401);
    });
});
