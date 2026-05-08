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

async function cleanProjects(): Promise<void> {
    const c = new Client({ connectionString: DB_URL });
    await c.connect();
    await c.query("DELETE FROM api_keys");
    await c.query("DELETE FROM projects");
    await c.end();
}

test.describe("Projects", () => {
    test.beforeEach(async () => {
        await cleanProjects();
    });

    test("projects page shows empty state when no projects exist", async ({ page }) => {
        const orgSlug = await getOrgSlug();
        await page.goto(`/${orgSlug}/projects`);
        await expect(page.getByText("No projects yet")).toBeVisible();
        await expect(page.getByRole("link", { name: "New project" })).toBeVisible();
    });

    test("create project → lands on dashboard placeholder", async ({ page }) => {
        const orgSlug = await getOrgSlug();
        await page.goto(`/${orgSlug}/projects/new`);

        await page.fill('input[placeholder="My API Server"]', "API Server");
        // Slug auto-fills to "api-server"
        await expect(page.locator('input[aria-label="Project slug"]')).toHaveValue("api-server");

        await page.click('button[type="submit"]');
        await page.waitForURL(`**/${orgSlug}/api-server`, { timeout: 15_000 });
        await expect(page.getByText("Dashboard")).toBeVisible();
    });

    test("project appears in the list after creation", async ({ page }) => {
        const orgSlug = await getOrgSlug();
        await page.goto(`/${orgSlug}/projects/new`);
        await page.fill('input[placeholder="My API Server"]', "My Test Project");
        await page.click('button[type="submit"]');
        await page.waitForURL(`**/${orgSlug}/my-test-project`, { timeout: 15_000 });

        await page.goto(`/${orgSlug}/projects`);
        await expect(page.getByText("My Test Project")).toBeVisible();
    });

    test("edit project name → slug update redirects", async ({ page }) => {
        const orgSlug = await getOrgSlug();
        await page.goto(`/${orgSlug}/projects/new`);
        await page.fill('input[placeholder="My API Server"]', "Edit Me");
        await page.click('button[type="submit"]');
        await page.waitForURL(`**/${orgSlug}/edit-me`, { timeout: 15_000 });

        await page.goto(`/${orgSlug}/edit-me/settings`);
        await page.fill('input[value="Edit Me"]', "Edited Project");
        await page.click('button[type="submit"]');
        await page.waitForURL(`**/${orgSlug}/edited-project/settings`, { timeout: 15_000 });
    });

    test("soft-delete project → URL returns 404", async ({ page }) => {
        const orgSlug = await getOrgSlug();
        await page.goto(`/${orgSlug}/projects/new`);
        await page.fill('input[placeholder="My API Server"]', "Delete Me");
        await page.click('button[type="submit"]');
        await page.waitForURL(`**/${orgSlug}/delete-me`, { timeout: 15_000 });

        await page.goto(`/${orgSlug}/delete-me/settings/danger`);
        await page.click('button:has-text("Delete project")');
        // Type confirmation slug
        await page.fill('input[placeholder="delete-me"]', "delete-me");
        await page.click('button:has-text("Delete project"):not(:disabled)');
        await page.waitForURL(`**/${orgSlug}/projects`, { timeout: 15_000 });

        // Verify the URL 404s
        const response = await page.goto(`/${orgSlug}/delete-me`);
        expect(response?.status()).toBe(404);

        // Verify DB has deleted_at set
        const c = new Client({ connectionString: DB_URL });
        await c.connect();
        const { rows } = await c.query("SELECT deleted_at FROM projects WHERE slug = 'delete-me'");
        await c.end();
        expect(rows[0]?.deleted_at).not.toBeNull();
    });
});
