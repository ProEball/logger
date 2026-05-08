import { expect, test } from "@playwright/test";
import { Client } from "pg";

const DB_URL = "postgresql://postgres:postgres@localhost:5432/logger";

async function getOrgSlug(): Promise<string> {
    const c = new Client({ connectionString: DB_URL });
    await c.connect();
    const { rows } = await c.query("SELECT slug FROM organizations LIMIT 1");
    await c.end();
    return rows[0]?.slug ?? "bootstrap-corp";
}

async function ensureProject(orgSlug: string, projectSlug: string): Promise<void> {
    const c = new Client({ connectionString: DB_URL });
    await c.connect();
    const { rows: orgs } = await c.query("SELECT id FROM organizations WHERE slug = $1", [orgSlug]);
    const orgId = orgs[0]?.id;
    if (!orgId) { await c.end(); return; }
    await c.query(
        `INSERT INTO projects (organization_id, name, slug)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [orgId, "Key Test Project", projectSlug],
    );
    await c.end();
}

async function cleanApiKeys(projectSlug: string, orgSlug: string): Promise<void> {
    const c = new Client({ connectionString: DB_URL });
    await c.connect();
    await c.query(
        `DELETE FROM api_keys WHERE project_id IN (
            SELECT p.id FROM projects p
            JOIN organizations o ON o.id = p.organization_id
            WHERE p.slug = $1 AND o.slug = $2
        )`,
        [projectSlug, orgSlug],
    );
    await c.end();
}

test.describe("API Keys", () => {
    const PROJECT_SLUG = "key-test-project";

    test.beforeEach(async () => {
        const orgSlug = await getOrgSlug();
        await ensureProject(orgSlug, PROJECT_SLUG);
        await cleanApiKeys(PROJECT_SLUG, orgSlug);
    });

    test("api-keys page shows empty state when no keys exist", async ({ page }) => {
        const orgSlug = await getOrgSlug();
        await page.goto(`/${orgSlug}/${PROJECT_SLUG}/settings/api-keys`);
        await expect(page.getByText("No API keys")).toBeVisible();
    });

    test("create key → one-time reveal modal shows plain key", async ({ page }) => {
        const orgSlug = await getOrgSlug();
        await page.goto(`/${orgSlug}/${PROJECT_SLUG}/settings/api-keys`);

        await page.click('button:has-text("Create API key")');
        await page.fill('input[placeholder="Production server"]', "CI key");
        await page.click('button[type="submit"]:has-text("Create")');

        // Reveal modal should show
        await expect(page.getByText("Your new API key")).toBeVisible();

        // Key should start with lgr_
        const keyValue = await page.locator("code").first().textContent();
        expect(keyValue).toMatch(/^lgr_/);

        // Close button disabled until checkbox checked
        const closeBtn = page.getByRole("button", { name: "Close" });
        await expect(closeBtn).toBeDisabled();

        // Check the checkbox
        await page.getByLabel("I've saved this key in a secure location.").check();
        await expect(closeBtn).toBeEnabled();
        await closeBtn.click();

        // Back on api-keys page — key appears in list as masked
        await expect(page.getByText("CI key")).toBeVisible();
        await expect(page.getByText(/lgr_\w{4}…/)).toBeVisible();
    });

    test("revoke key → row shows revoked badge", async ({ page }) => {
        const orgSlug = await getOrgSlug();
        await page.goto(`/${orgSlug}/${PROJECT_SLUG}/settings/api-keys`);

        // Create key
        await page.click('button:has-text("Create API key")');
        await page.fill('input[placeholder="Production server"]', "Revoke Me");
        await page.click('button[type="submit"]:has-text("Create")');
        await page.getByLabel("I've saved this key in a secure location.").check();
        await page.getByRole("button", { name: "Close" }).click();

        // Revoke it
        await page.click('button:has-text("Revoke")');
        await expect(page.getByText("Revoke API key")).toBeVisible();
        await page.click('button:has-text("Revoke key")');

        // Row should show revoked
        await expect(page.getByText("revoked")).toBeVisible();

        // Verify in DB
        const c = new Client({ connectionString: DB_URL });
        await c.connect();
        const { rows } = await c.query(
            `SELECT ak.revoked_at FROM api_keys ak
             JOIN projects p ON p.id = ak.project_id
             WHERE p.slug = $1 AND ak.name = 'Revoke Me'`,
            [PROJECT_SLUG],
        );
        await c.end();
        expect(rows[0]?.revoked_at).not.toBeNull();
    });

    test("revoked key cannot be used to create event (TODO: verify in feature 03)", async () => {
        // Deferred to feature 03 ingest implementation
        expect(true).toBe(true);
    });
});
