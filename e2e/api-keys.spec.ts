import { expect, test } from "@playwright/test";
import { randomUUID } from "crypto";
import { withDb } from "@/e2e/support/db";
import { resetDb } from "@/e2e/support/cleanup";
import { bootstrapOrg, login } from "@/e2e/support/auth";
import { labelFor } from "@/e2e/support/ui";

const ORG_SLUG = "api-keys-corp";
const EMAIL = "alice@api-keys.test";
const PASS = "AlicePass99!";
const PROJECT_SLUG = "key-test-project";

let orgId: string;

async function cleanApiKeys(): Promise<void> {
    await withDb((c) =>
        c.query(
            `DELETE FROM api_keys WHERE project_id IN (SELECT id FROM projects WHERE organization_id = $1)`,
            [orgId],
        ),
    );
}

test.describe.serial("API Keys", () => {
    test.beforeAll(async ({ browser }) => {
        await resetDb();

        const setupCtx = await browser.newContext();
        const setupPage = await setupCtx.newPage();
        await bootstrapOrg(setupPage, {
            orgName: "Api Keys Corp",
            ownerName: "Alice Owner",
            email: EMAIL,
            password: PASS,
            orgSlug: ORG_SLUG,
        });
        await setupCtx.close();

        const { rows } = await withDb((c) => c.query("SELECT id FROM organizations WHERE slug = $1", [ORG_SLUG]));
        orgId = rows[0].id;
        await withDb((c) =>
            c.query(
                `INSERT INTO projects (id, organization_id, name, slug) VALUES ($1, $2, $3, $4)`,
                [randomUUID(), orgId, "Key Test Project", PROJECT_SLUG],
            ),
        );
    });

    test.beforeEach(async () => {
        await cleanApiKeys();
    });

    test("api-keys page shows empty state when no keys exist", async ({ page }) => {
        await login(page, EMAIL, PASS, ORG_SLUG);
        await page.goto(`/${ORG_SLUG}/${PROJECT_SLUG}/settings/api-keys`);
        await expect(page.getByText("No API keys")).toBeVisible();
    });

    test("create key → one-time reveal modal shows plain key", async ({ page }) => {
        await login(page, EMAIL, PASS, ORG_SLUG);
        await page.goto(`/${ORG_SLUG}/${PROJECT_SLUG}/settings/api-keys`);

        await page.click('button:has-text("Create API key")');
        await page.fill('input[placeholder="Production server"]', "CI key");
        await page.click('button[type="submit"]:has-text("Create")');

        // Reveal modal should show
        await expect(page.getByText("Your new API key")).toBeVisible();

        // Key should start with lgr_
        const keyValue = await page.locator("code").first().textContent();
        expect(keyValue).toMatch(/^lgr_/);

        // Close button disabled until checkbox checked
        // The modal also has an icon-only "Close" (aria-label) button — scope to
        // the visible-text footer button to avoid a strict-mode ambiguity.
        const closeBtn = page.getByRole("button").filter({ hasText: "Close" });
        await expect(closeBtn).toBeDisabled();

        // Check the checkbox (click the wrapping label — a decorative <span>
        // overlays the native input and would intercept a direct click on it).
        await labelFor(page, page.getByLabel("I've saved this key in a secure location.")).click();
        await expect(closeBtn).toBeEnabled();
        await closeBtn.click();

        // Back on api-keys page — key appears in list as masked. "CI key" also
        // appears in hidden revoke/delete/rate-limit dialog templates in the
        // DOM, so scope to the table.
        const table = page.getByRole("table");
        await expect(table.getByText("CI key")).toBeVisible();
        await expect(table.getByText(/lgr_\w{4}…/)).toBeVisible();
    });

    test("revoke key → row shows revoked badge", async ({ page }) => {
        await login(page, EMAIL, PASS, ORG_SLUG);
        await page.goto(`/${ORG_SLUG}/${PROJECT_SLUG}/settings/api-keys`);

        // Create key
        await page.click('button:has-text("Create API key")');
        await page.fill('input[placeholder="Production server"]', "Revoke Me");
        await page.click('button[type="submit"]:has-text("Create")');
        await labelFor(page, page.getByLabel("I've saved this key in a secure location.")).click();
        await page.getByRole("button").filter({ hasText: "Close" }).click();

        // Revoke it
        await page.click('button:has-text("Revoke")');
        await expect(page.getByText("Revoke API key")).toBeVisible();
        await page.click('button:has-text("Revoke key")');

        // Row should show revoked. A toast notification also says "revoked" —
        // scope to the table to avoid a strict-mode ambiguity.
        await expect(page.getByRole("table").getByText("revoked")).toBeVisible();

        // Verify in DB
        const { rows } = await withDb((c) =>
            c.query(
                `SELECT ak.revoked_at FROM api_keys ak
                 JOIN projects p ON p.id = ak.project_id
                 WHERE p.slug = $1 AND ak.name = 'Revoke Me'`,
                [PROJECT_SLUG],
            ),
        );
        expect(rows[0]?.revoked_at).not.toBeNull();
    });
});
