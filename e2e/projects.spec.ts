import { expect, test } from "@playwright/test";
import { withDb } from "@/e2e/support/db";
import { resetDb } from "@/e2e/support/cleanup";
import { bootstrapOrg, login } from "@/e2e/support/auth";

const ORG_SLUG = "projects-corp";
const EMAIL = "alice@projects.test";
const PASS = "AlicePass99!";

let orgId: string;

async function cleanProjects(): Promise<void> {
    await withDb(async (c) => {
        await c.query(
            `DELETE FROM events WHERE project_id IN (SELECT id FROM projects WHERE organization_id = $1)`,
            [orgId],
        );
        await c.query(
            `DELETE FROM api_keys WHERE project_id IN (SELECT id FROM projects WHERE organization_id = $1)`,
            [orgId],
        );
        await c.query(`DELETE FROM projects WHERE organization_id = $1`, [orgId]);
    });
}

test.describe.serial("Projects", () => {
    test.beforeAll(async ({ browser }) => {
        await resetDb();

        const setupCtx = await browser.newContext();
        const setupPage = await setupCtx.newPage();
        await bootstrapOrg(setupPage, {
            orgName: "Projects Corp",
            ownerName: "Alice Owner",
            email: EMAIL,
            password: PASS,
            orgSlug: ORG_SLUG,
        });
        await setupCtx.close();

        const { rows } = await withDb((c) => c.query("SELECT id FROM organizations WHERE slug = $1", [ORG_SLUG]));
        orgId = rows[0].id;
    });

    test.beforeEach(async () => {
        await cleanProjects();
    });

    test("projects page shows empty state when no projects exist", async ({ page }) => {
        await login(page, EMAIL, PASS, ORG_SLUG);
        await page.goto(`/${ORG_SLUG}/projects`);
        await expect(page.getByText("No projects yet")).toBeVisible();
        // Both the page header and the empty-state body render a "New project"
        // link when the list is empty — just confirm at least one is visible.
        await expect(page.getByRole("link", { name: "New project" }).first()).toBeVisible();
    });

    test("create project → lands on dashboard placeholder", async ({ page }) => {
        await login(page, EMAIL, PASS, ORG_SLUG);
        await page.goto(`/${ORG_SLUG}/projects/new`);

        await page.fill('input[placeholder="My API Server"]', "API Server");
        // Slug auto-fills to "api-server"
        await expect(page.locator('input[aria-label="Project slug"]')).toHaveValue("api-server");

        await page.click('button[type="submit"]');
        await page.waitForURL(`**/${ORG_SLUG}/api-server`, { timeout: 15_000 });
        await expect(page.getByText("Dashboard")).toBeVisible();
    });

    test("project appears in the list after creation", async ({ page }) => {
        await login(page, EMAIL, PASS, ORG_SLUG);
        await page.goto(`/${ORG_SLUG}/projects/new`);
        await page.fill('input[placeholder="My API Server"]', "My Test Project");
        await page.click('button[type="submit"]');
        await page.waitForURL(`**/${ORG_SLUG}/my-test-project`, { timeout: 15_000 });

        await page.goto(`/${ORG_SLUG}/projects`);
        // The sidebar nav also links to every project by name, and the card's
        // own child elements share the "ProjectCard" class prefix too — scope
        // to just the card's root <a> to avoid a strict-mode ambiguity.
        await expect(
            page.locator('a[class*="ProjectCard"]').filter({ hasText: "My Test Project" }),
        ).toBeVisible();
    });

    test("edit project name → slug update redirects", async ({ page }) => {
        await login(page, EMAIL, PASS, ORG_SLUG);
        await page.goto(`/${ORG_SLUG}/projects/new`);
        await page.fill('input[placeholder="My API Server"]', "Edit Me");
        await page.click('button[type="submit"]');
        await page.waitForURL(`**/${ORG_SLUG}/edit-me`, { timeout: 15_000 });

        await page.goto(`/${ORG_SLUG}/edit-me/settings`);
        await page.fill('input[value="Edit Me"]', "Edited Project");
        await page.click('button[type="submit"]');
        await page.waitForURL(`**/${ORG_SLUG}/edited-project/settings`, { timeout: 15_000 });
    });

    test("soft-delete project → URL returns 404", async ({ page }) => {
        await login(page, EMAIL, PASS, ORG_SLUG);
        await page.goto(`/${ORG_SLUG}/projects/new`);
        await page.fill('input[placeholder="My API Server"]', "Delete Me");
        await page.click('button[type="submit"]');
        await page.waitForURL(`**/${ORG_SLUG}/delete-me`, { timeout: 15_000 });

        await page.goto(`/${ORG_SLUG}/delete-me/settings/danger`);
        await page.click('button:has-text("Delete project")');
        // Type confirmation slug. The page behind the modal has its own
        // "Delete project" button too, so scope the submit click to the dialog.
        const dialog = page.locator("dialog[open]");
        await dialog.locator('input[placeholder="delete-me"]').fill("delete-me");
        await dialog.locator('button:has-text("Delete project"):not(:disabled)').click();
        await page.waitForURL(`**/${ORG_SLUG}/projects`, { timeout: 15_000 });

        // Verify the URL 404s
        const response = await page.goto(`/${ORG_SLUG}/delete-me`);
        expect(response?.status()).toBe(404);

        // Verify DB has deleted_at set
        const { rows } = await withDb((c) => c.query("SELECT deleted_at FROM projects WHERE slug = 'delete-me'"));
        expect(rows[0]?.deleted_at).not.toBeNull();
    });
});
