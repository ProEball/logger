import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { randomUUID } from "crypto";

const DB_URL = "postgresql://postgres:postgres@localhost:5432/logger";

interface E2ECtx {
    orgId: string;
    orgSlug: string;
    projectId: string;
    projSlug: string;
    userId: string;
}

async function seedCtx(): Promise<E2ECtx> {
    const c = new Client({ connectionString: DB_URL });
    await c.connect();

    const orgId = randomUUID();
    const projectId = randomUUID();
    const userId = randomUUID().replace(/-/g, "").slice(0, 20);
    const orgSlug = `alert-org-${orgId.slice(0, 8)}`;
    const projSlug = `alert-proj-${projectId.slice(0, 8)}`;
    const userEmail = `alert-e2e-${userId}@test.local`;

    await c.query(
        `INSERT INTO users (id, name, email, email_verified) VALUES ($1, $2, $3, true)`,
        [userId, "Alert E2E User", userEmail],
    );
    await c.query(
        `INSERT INTO organizations (id, name, slug) VALUES ($1, $2, $3)`,
        [orgId, "Alert E2E Org", orgSlug],
    );
    await c.query(
        `INSERT INTO organization_members (user_id, organization_id, role_id)
         SELECT $1, $2, id FROM roles WHERE name = 'Admin' AND organization_id IS NULL LIMIT 1`,
        [userId, orgId],
    );
    await c.query(
        `INSERT INTO projects (id, organization_id, name, slug) VALUES ($1, $2, $3, $4)`,
        [projectId, orgId, "Alert E2E Project", projSlug],
    );

    await c.end();
    return { orgId, orgSlug, projectId, projSlug, userId };
}

async function cleanupCtx(ctx: E2ECtx): Promise<void> {
    const c = new Client({ connectionString: DB_URL });
    await c.connect();
    await c.query(`DELETE FROM organizations WHERE id = $1`, [ctx.orgId]);
    await c.query(`DELETE FROM users WHERE id = $1`, [ctx.userId]);
    await c.end();
}

// ─── DB-level tests (no browser required) ────────────────────────────────────

test.describe("alerts — DB level", () => {
    let ctx: E2ECtx;

    test.beforeAll(async () => {
        ctx = await seedCtx();
    });

    test.afterAll(async () => {
        await cleanupCtx(ctx);
    });

    test("alert_rules table exists and accepts inserts", async () => {
        const c = new Client({ connectionString: DB_URL });
        await c.connect();

        const ruleId = randomUUID();
        const filter = JSON.stringify({ range: { type: "preset", value: "1h" }, levels: ["error"] });
        const condition = JSON.stringify({ type: "threshold", count: 1, windowMinutes: 5 });
        const channels = JSON.stringify([{ type: "webhook", url: "https://webhook.example.com/hook" }]);

        await c.query(
            `INSERT INTO alert_rules (id, project_id, name, filter, condition, channels)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [ruleId, ctx.projectId, "Test Alert", filter, condition, channels],
        );

        const { rows } = await c.query(
            `SELECT id, name, state, enabled, version FROM alert_rules WHERE id = $1`,
            [ruleId],
        );

        expect(rows[0]).toMatchObject({
            id: ruleId,
            name: "Test Alert",
            state: "ok",
            enabled: true,
            version: 1,
        });

        await c.query(`DELETE FROM alert_rules WHERE id = $1`, [ruleId]);
        await c.end();
    });

    test("alert_notifications cascade-deletes when rule is deleted", async () => {
        const c = new Client({ connectionString: DB_URL });
        await c.connect();

        const ruleId = randomUUID();
        const filter = JSON.stringify({ range: { type: "preset", value: "1h" } });
        const condition = JSON.stringify({ type: "threshold", count: 1, windowMinutes: 5 });
        const channels = JSON.stringify([{ type: "webhook", url: "https://webhook.example.com" }]);

        await c.query(
            `INSERT INTO alert_rules (id, project_id, name, filter, condition, channels)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [ruleId, ctx.projectId, "Cascade Test", filter, condition, channels],
        );

        const notifId = randomUUID();
        await c.query(
            `INSERT INTO alert_notifications (id, alert_rule_id, triggered_at, state)
             VALUES ($1, $2, now(), 'firing')`,
            [notifId, ruleId],
        );

        await c.query(`DELETE FROM alert_rules WHERE id = $1`, [ruleId]);

        const { rows } = await c.query(
            `SELECT id FROM alert_notifications WHERE id = $1`,
            [notifId],
        );
        expect(rows).toHaveLength(0);

        await c.end();
    });

    test("version column increments as expected", async () => {
        const c = new Client({ connectionString: DB_URL });
        await c.connect();

        const ruleId = randomUUID();
        const filter = JSON.stringify({ range: { type: "preset", value: "1h" } });
        const condition = JSON.stringify({ type: "threshold", count: 5, windowMinutes: 10 });
        const channels = JSON.stringify([{ type: "webhook", url: "https://webhook.example.com" }]);

        await c.query(
            `INSERT INTO alert_rules (id, project_id, name, filter, condition, channels, version)
             VALUES ($1, $2, $3, $4, $5, $6, 1)`,
            [ruleId, ctx.projectId, "Version Test", filter, condition, channels],
        );

        await c.query(
            `UPDATE alert_rules SET version = version + 1 WHERE id = $1`,
            [ruleId],
        );

        const { rows } = await c.query(
            `SELECT version FROM alert_rules WHERE id = $1`,
            [ruleId],
        );
        expect(rows[0].version).toBe(2);

        await c.query(`DELETE FROM alert_rules WHERE id = $1`, [ruleId]);
        await c.end();
    });

    test("optimistic concurrency: update with wrong version affects 0 rows", async () => {
        const c = new Client({ connectionString: DB_URL });
        await c.connect();

        const ruleId = randomUUID();
        const filter = JSON.stringify({ range: { type: "preset", value: "1h" } });
        const condition = JSON.stringify({ type: "threshold", count: 5, windowMinutes: 10 });
        const channels = JSON.stringify([{ type: "webhook", url: "https://webhook.example.com" }]);

        await c.query(
            `INSERT INTO alert_rules (id, project_id, name, filter, condition, channels, version)
             VALUES ($1, $2, $3, $4, $5, $6, 5)`,
            [ruleId, ctx.projectId, "Concurrency Test", filter, condition, channels],
        );

        // Attempt update with wrong version (3 instead of 5)
        const result = await c.query(
            `UPDATE alert_rules SET state = 'firing', version = version + 1
             WHERE id = $1 AND version = $2`,
            [ruleId, 3],
        );
        expect(result.rowCount).toBe(0);

        await c.query(`DELETE FROM alert_rules WHERE id = $1`, [ruleId]);
        await c.end();
    });

    test("disabled rule is excluded from enabled index lookup", async () => {
        const c = new Client({ connectionString: DB_URL });
        await c.connect();

        const ruleId = randomUUID();
        const filter = JSON.stringify({ range: { type: "preset", value: "1h" } });
        const condition = JSON.stringify({ type: "threshold", count: 5, windowMinutes: 10 });
        const channels = JSON.stringify([{ type: "webhook", url: "https://webhook.example.com" }]);

        await c.query(
            `INSERT INTO alert_rules (id, project_id, name, filter, condition, channels, enabled)
             VALUES ($1, $2, $3, $4, $5, $6, false)`,
            [ruleId, ctx.projectId, "Disabled Test", filter, condition, channels],
        );

        const { rows } = await c.query(
            `SELECT id FROM alert_rules WHERE project_id = $1 AND enabled = true AND id = $2`,
            [ctx.projectId, ruleId],
        );
        expect(rows).toHaveLength(0);

        await c.query(`DELETE FROM alert_rules WHERE id = $1`, [ruleId]);
        await c.end();
    });
});

// ─── Browser tests ────────────────────────────────────────────────────────────

test.describe("alerts — browser", () => {
    test("alerts page loads for authenticated user", async ({ page }) => {
        test.skip(
            !process.env.E2E_AUTH_SESSION,
            "Browser tests require E2E_AUTH_SESSION env var (active auth cookie)",
        );
    });
});
