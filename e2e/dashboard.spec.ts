import { expect, test } from "@playwright/test";
import { randomUUID } from "crypto";
import { withDb } from "@/e2e/support/db";
import { resetDb } from "@/e2e/support/cleanup";
import { bootstrapOrg, login } from "@/e2e/support/auth";
import { generateApiKey, extractKeyPrefix, hashApiKey } from "@/e2e/support/api-keys";
import { BASE_URL } from "@/e2e/support/env";

const ORG_SLUG = "dash-corp";
const EMAIL = "alice@dash.test";
const PASS = "AlicePass99!";
const PROJECT_SLUG = "dash-project";
const EMPTY_PROJECT_SLUG = "dash-empty-project";

interface ProjectCtx {
    projectId: string;
    apiKey: string;
}

async function seedProject(orgId: string, name: string, slug: string): Promise<ProjectCtx> {
    const projectId = randomUUID();
    const apiKey = generateApiKey();
    await withDb(async (c) => {
        await c.query(
            `INSERT INTO projects (id, organization_id, name, slug) VALUES ($1, $2, $3, $4)`,
            [projectId, orgId, name, slug],
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
        message: `dashboard test event ${i}`,
        ...overrides,
    }));
    const res = await fetch(`${BASE_URL}/api/ingest/batch`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(batch),
    });
    if (!res.ok) throw new Error(`Ingest failed: ${res.status}`);
}

let orgId: string;
let project: ProjectCtx;
let emptyProject: ProjectCtx;

test.describe.serial("Dashboard", () => {
    test.beforeAll(async ({ browser }) => {
        await resetDb();

        const setupCtx = await browser.newContext();
        const setupPage = await setupCtx.newPage();
        await bootstrapOrg(setupPage, {
            orgName: "Dash Corp",
            ownerName: "Alice Owner",
            email: EMAIL,
            password: PASS,
            orgSlug: ORG_SLUG,
        });
        await setupCtx.close();

        const { rows } = await withDb((c) => c.query("SELECT id FROM organizations WHERE slug = $1", [ORG_SLUG]));
        orgId = rows[0].id;

        project = await seedProject(orgId, "Dash Project", PROJECT_SLUG);
        emptyProject = await seedProject(orgId, "Empty Dash Project", EMPTY_PROJECT_SLUG);

        // Seed mixed events: 20 info + 5 error with stack traces + 5 warn
        await seedEvents(project.apiKey, 20, {});
        await seedEvents(project.apiKey, 5, {
            level: "error",
            error_type: "TypeError",
            stack_trace: "TypeError: oops\n    at fn (app.js:10:5)",
            environment: "production",
        });
        await seedEvents(project.apiKey, 5, {
            level: "warn",
            environment: "staging",
        });
    });

    // ── DB-level aggregation assertions ──────────────────────────────────────

    test("Level breakdown — 3 distinct levels ingested", async () => {
        const { rows } = await withDb((c) =>
            c.query<{ level: string; cnt: string }>(
                `SELECT level, COUNT(*)::text AS cnt
                 FROM events WHERE project_id = $1
                 GROUP BY level ORDER BY cnt DESC`,
                [project.projectId],
            ),
        );
        const levels = rows.map((r) => r.level);
        expect(levels).toContain("info");
        expect(levels).toContain("error");
        expect(levels).toContain("warn");
    });

    test("Environment breakdown — 2 distinct environments + nulls", async () => {
        const { rows } = await withDb((c) =>
            c.query<{ env: string }>(
                `SELECT COALESCE(environment, '(unset)') AS env
                 FROM events WHERE project_id = $1
                 GROUP BY 1`,
                [project.projectId],
            ),
        );
        const envs = rows.map((r) => r.env);
        expect(envs).toContain("production");
        expect(envs).toContain("staging");
        expect(envs).toContain("(unset)");
    });

    test("Top messages — at least one grouped message row", async () => {
        const { rows } = await withDb((c) =>
            c.query<{ cnt: string }>(
                `SELECT COUNT(*)::text AS cnt FROM (
                    SELECT SUBSTRING(message, 1, 200)
                    FROM events WHERE project_id = $1
                    GROUP BY 1
                 ) sub`,
                [project.projectId],
            ),
        );
        expect(Number(rows[0].cnt)).toBeGreaterThan(0);
    });

    test("Recent errors — 5 error/fatal events seeded", async () => {
        const { rows } = await withDb((c) =>
            c.query<{ cnt: string }>(
                `SELECT COUNT(*)::text AS cnt
                 FROM events WHERE project_id = $1 AND level IN ('error', 'fatal')`,
                [project.projectId],
            ),
        );
        expect(Number(rows[0].cnt)).toBe(5);
    });

    test("Time-series buckets — 30 events in last 1h window", async () => {
        const { rows } = await withDb((c) =>
            c.query<{ cnt: string }>(
                `SELECT COUNT(*)::text AS cnt
                 FROM events
                 WHERE project_id = $1
                   AND timestamp >= now() - interval '1 hour'`,
                [project.projectId],
            ),
        );
        expect(Number(rows[0].cnt)).toBe(30);
    });

    test("Empty project — has_any_events returns false", async () => {
        const { rows } = await withDb((c) =>
            c.query<{ has_events: boolean }>(
                `SELECT EXISTS (SELECT 1 FROM events WHERE project_id = $1 LIMIT 1) AS has_events`,
                [emptyProject.projectId],
            ),
        );
        expect(rows[0].has_events).toBe(false);
    });

    // ── Browser-rendered assertions ────────────────────────────────────────

    test("GET /[org]/[project] → dashboard renders", async ({ page }) => {
        await login(page, EMAIL, PASS, ORG_SLUG);
        await page.goto(`/${ORG_SLUG}/${PROJECT_SLUG}?range=1h`);
        // Wait for at least one widget card title to appear
        await page.waitForSelector("h2", { timeout: 10_000 });
    });

    test("GET /[org]/[project] (empty project) → shows onboarding CTA", async ({ page }) => {
        await login(page, EMAIL, PASS, ORG_SLUG);
        await page.goto(`/${ORG_SLUG}/${EMPTY_PROJECT_SLUG}`);
        // The empty state page contains the curl example
        const text = await page.textContent("body");
        expect(text).toContain("curl");
    });
});
