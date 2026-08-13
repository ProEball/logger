import { expect, test } from "@playwright/test";
import { randomUUID } from "crypto";
import { withDb } from "@/e2e/support/db";
import { resetDb } from "@/e2e/support/cleanup";
import { bootstrapOrg, login } from "@/e2e/support/auth";
import { labelFor } from "@/e2e/support/ui";

const ORG_SLUG = "alerts-corp";
const EMAIL = "alice@alerts.test";
const PASS = "AlicePass99!";
const PROJECT_SLUG = "alerts-project";

let projectId: string;

test.describe.serial("Alert rules — create, toggle, delete through the real UI", () => {
    test.beforeAll(async ({ browser }) => {
        await resetDb();

        const setupCtx = await browser.newContext();
        const setupPage = await setupCtx.newPage();
        await bootstrapOrg(setupPage, {
            orgName: "Alerts Corp",
            ownerName: "Alice Owner",
            email: EMAIL,
            password: PASS,
            orgSlug: ORG_SLUG,
        });
        await setupCtx.close();

        const { rows } = await withDb((c) => c.query("SELECT id FROM organizations WHERE slug = $1", [ORG_SLUG]));
        projectId = randomUUID();
        await withDb((c) =>
            c.query(
                `INSERT INTO projects (id, organization_id, name, slug) VALUES ($1, $2, $3, $4)`,
                [projectId, rows[0].id, "Alerts Project", PROJECT_SLUG],
            ),
        );
    });

    test("creating a rule through AlertRuleEditor persists it and shows it in the list", async ({ page }) => {
        await login(page, EMAIL, PASS, ORG_SLUG);
        await page.goto(`/${ORG_SLUG}/${PROJECT_SLUG}/alerts/new`);
        await page.waitForLoadState("networkidle");

        await page.fill('input[placeholder="e.g. High error rate"]', "High error rate");
        await page.fill('input[placeholder="https://hooks.slack.com/services/..."]', "https://webhook.example.com/hook");
        await page.getByRole("button", { name: "Save rule" }).click();

        await page.waitForURL(`**/${ORG_SLUG}/${PROJECT_SLUG}/alerts`, { timeout: 15_000 });
        await expect(page.getByText("High error rate")).toBeVisible();

        const { rows } = await withDb((c) =>
            c.query(
                `SELECT name, state, enabled, version, channels FROM alert_rules WHERE project_id = $1`,
                [projectId],
            ),
        );
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ name: "High error rate", state: "ok", enabled: true, version: 1 });
        expect(rows[0].channels[0].url).toBe("https://webhook.example.com/hook");
    });

    test("disabling a rule via the list Switch updates enabled in DB", async ({ page }) => {
        await login(page, EMAIL, PASS, ORG_SLUG);
        await page.goto(`/${ORG_SLUG}/${PROJECT_SLUG}/alerts`);
        await page.waitForLoadState("networkidle");

        await labelFor(page, page.getByRole("switch", { name: "Disable" })).click();

        await expect
            .poll(async () => {
                const { rows } = await withDb((c) =>
                    c.query(`SELECT enabled FROM alert_rules WHERE project_id = $1`, [projectId]),
                );
                return rows[0]?.enabled;
            }, { timeout: 10_000 })
            .toBe(false);
    });

    test("re-enabling a rule via the list Switch updates enabled in DB", async ({ page }) => {
        await login(page, EMAIL, PASS, ORG_SLUG);
        await page.goto(`/${ORG_SLUG}/${PROJECT_SLUG}/alerts`);
        await page.waitForLoadState("networkidle");

        await labelFor(page, page.getByRole("switch", { name: "Enable" })).click();

        await expect
            .poll(async () => {
                const { rows } = await withDb((c) =>
                    c.query(`SELECT enabled FROM alert_rules WHERE project_id = $1`, [projectId]),
                );
                return rows[0]?.enabled;
            }, { timeout: 10_000 })
            .toBe(true);
    });

    test("deleting a rule removes it from the list and the DB", async ({ page }) => {
        await login(page, EMAIL, PASS, ORG_SLUG);
        await page.goto(`/${ORG_SLUG}/${PROJECT_SLUG}/alerts`);
        await page.waitForLoadState("networkidle");

        page.once("dialog", (dialog) => dialog.accept());
        await page.getByRole("button", { name: "Delete" }).click();

        await expect(page.getByText("High error rate")).not.toBeVisible();

        await expect
            .poll(async () => {
                const { rows } = await withDb((c) =>
                    c.query(`SELECT id FROM alert_rules WHERE project_id = $1`, [projectId]),
                );
                return rows.length;
            }, { timeout: 10_000 })
            .toBe(0);
    });
});
