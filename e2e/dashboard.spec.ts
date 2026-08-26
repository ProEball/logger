import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "crypto";
import { withDb } from "@/e2e/support/db";
import { resetDb } from "@/e2e/support/cleanup";
import { bootstrapOrg, login } from "@/e2e/support/auth";
import { generateApiKey, extractKeyPrefix, hashApiKey } from "@/e2e/support/api-keys";
import { BASE_URL } from "@/e2e/support/env";

/**
 * The project dashboard, **through the page**.
 *
 * ## Why this file was rewritten in Phase 4
 *
 * Six of its eight tests used to query the database directly — `SELECT level,
 * COUNT(*) FROM events GROUP BY level` and five more of the same shape — and
 * assert on the rows. They ran no aggregation the application owns and rendered
 * nothing; the two that did open a browser checked that an `<h2>` existed and
 * that the empty state contained the word "curl".
 *
 * That made "dashboards e2e green" — the stated gate for moving the
 * aggregations to ClickHouse — a gate a completely broken dashboard would have
 * passed. Phase 3 hit the same thing in `events.spec.ts` and said so; §12.3
 * flagged that Phase 4's gate was phrased identically. This is that flag being
 * acted on rather than repeated.
 *
 * Every assertion below reads a number the page computed. A widget that returns
 * nothing, ranks wrongly, or loses a level fails here.
 */

const ORG_SLUG = "dash-corp";
const EMAIL = "alice@dash.test";
const PASS = "AlicePass99!";
const PROJECT_SLUG = "dash-project";
const EMPTY_PROJECT_SLUG = "dash-empty-project";

/**
 * The corpus, chosen so the widgets have something to be wrong about.
 *
 * - 20 identical info messages: one template, the largest group.
 * - 5 errors whose order ids differ. `order o_1000 failed` normalises to
 *   `order *** failed`, so they are one group of five rather than five of one.
 *   That collapse is what `topMessages` groups by since Phase 4, and this is
 *   the only end-to-end check that the template reaches the page.
 * - 5 warns, in their own environment, so the level breakdown has three bars
 *   and the environment filter has something to narrow to.
 */
const HEARTBEAT = "dashboard heartbeat";
const ORDER_TEMPLATE = "order *** failed";
const TOTAL_EVENTS = 30;

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

/** Through the real ingest endpoint, so the rows are the ones ingest writes. */
async function ingest(apiKey: string, events: Array<Record<string, unknown>>): Promise<void> {
    const res = await fetch(`${BASE_URL}/api/ingest/batch`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(events),
    });
    if (!res.ok) throw new Error(`Ingest failed: ${res.status}`);
}

let orgId: string;
let project: ProjectCtx;

/**
 * Open the dashboard and wait for the KPI row.
 *
 * `env` is the search param the filter bar emits — a single value, not a list;
 * see `parseDashboardFilters`.
 */
async function openDashboard(page: Page, params = "range=1h"): Promise<void> {
    await login(page, EMAIL, PASS, ORG_SLUG);
    await page.goto(`/${ORG_SLUG}/${PROJECT_SLUG}?${params}`);
    await expect(page.getByRole("group", { name: "Total events" })).toBeVisible({
        timeout: 15_000,
    });
}

/** One KPI card, addressed by the label it renders. */
function kpi(page: Page, label: string) {
    return page.getByRole("group", { name: label });
}

/** One widget panel, addressed by its title. */
function widget(page: Page, title: string) {
    return page.getByRole("region", { name: title });
}

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
        // Created for its slug alone: the onboarding test navigates to it and
        // asserts on what the page renders, not on anything about the row.
        await seedProject(orgId, "Empty Dash Project", EMPTY_PROJECT_SLUG);

        await ingest(project.apiKey, [
            ...Array.from({ length: 20 }, () => ({
                level: "info",
                message: HEARTBEAT,
                source: "api",
            })),
            ...Array.from({ length: 5 }, (_, i) => ({
                level: "error",
                message: `order o_100${i} failed`,
                error_type: "TypeError",
                stack_trace: "TypeError: oops\n    at fn (app.js:10:5)",
                environment: "production",
                source: "worker",
            })),
            ...Array.from({ length: 5 }, () => ({
                level: "warn",
                message: "disk usage high",
                environment: "staging",
                source: "cron",
            })),
        ]);
    });

    test("the KPI row shows the totals the aggregations computed", async ({ page }) => {
        // 30 events, 5 of them error or fatal, 0 fatal. The three numbers come
        // from two different queries — the bucket series and the level
        // breakdown — so a widget that silently returned nothing shows here as
        // a zero rather than as a blank card.
        await openDashboard(page);

        await expect(kpi(page, "Total events")).toContainText(String(TOTAL_EVENTS));
        await expect(kpi(page, "Errors")).toContainText("5");
        await expect(kpi(page, "Fatal")).toContainText("0");
    });

    test("the level breakdown shows every level that was ingested", async ({ page }) => {
        await openDashboard(page);
        const panel = widget(page, "By level");

        await expect(panel).toContainText("info");
        await expect(panel).toContainText("error");
        await expect(panel).toContainText("warn");
        // Its subtitle is the sum, so a breakdown that dropped a level would
        // disagree with the KPI card above rather than merely look short.
        await expect(panel).toContainText(`${TOTAL_EVENTS} events`);
    });

    test("top messages groups the five orders into one template row", async ({ page }) => {
        // The Phase 4 behaviour change, end to end. The five events differ —
        // `order o_1000 failed` … `order o_1004 failed` — and must appear as a
        // single row labelled with the template. Under the Postgres raw path
        // they were five rows of one; under the rollup path one row of five;
        // which you got depended on coverage and nothing tested it.
        await openDashboard(page);
        const panel = widget(page, "Top messages");

        await expect(panel).toContainText(ORDER_TEMPLATE, { timeout: 15_000 });
        await expect(panel).toContainText(HEARTBEAT);

        // 20 beats 5, so the heartbeat ranks first. Ordering is what three
        // shipped `ORDER BY` defects in this codebase got wrong.
        const rows = panel.getByRole("button");
        await expect(rows.first()).toContainText(HEARTBEAT);
        await expect(rows.first()).toContainText("20");
    });

    test("top sources ranks the three sources", async ({ page }) => {
        await openDashboard(page);
        const panel = widget(page, "Top Sources");

        await expect(panel).toContainText("api");
        await expect(panel).toContainText("worker");
        await expect(panel).toContainText("cron");
    });

    test("recent errors lists whole events, not templates", async ({ page }) => {
        // The only widget that returns whole events rather than an aggregate,
        // so it is the only one exercising the reverse row mapper on this page.
        await openDashboard(page);
        const panel = widget(page, "Recent errors");

        // The **raw** message, not the template — which is the difference
        // between this widget and Top messages above, and the reason both are
        // asserted. A row here that read "order *** failed" would mean an
        // individual event had been replaced by its group.
        await expect(panel).toContainText("order o_100");
        await expect(panel).not.toContainText(ORDER_TEMPLATE);
        // Source and environment come off the same row, so a mapper that
        // dropped a field shows here rather than in a count.
        await expect(panel).toContainText("worker");
        await expect(panel).toContainText("production");
    });

    test("an empty project shows the onboarding CTA instead of widgets", async ({ page }) => {
        // `hasAnyEvents` gates this, and it is the one read with no time bound.
        await login(page, EMAIL, PASS, ORG_SLUG);
        await page.goto(`/${ORG_SLUG}/${EMPTY_PROJECT_SLUG}`);

        const text = await page.textContent("body");
        expect(text).toContain("curl");
        await expect(page.getByRole("group", { name: "Total events" })).toHaveCount(0);
    });

    test("selecting an environment narrows every widget at once", async ({ page }) => {
        // production carries the 5 errors and nothing else, so the total and
        // the error count must agree at 5. Nothing else in this suite would
        // notice if the environment clause stopped narrowing — or, as it did
        // under Postgres for the `(unset)` pill, started matching nothing.
        await openDashboard(page, "range=1h&env=production");

        await expect(kpi(page, "Total events")).toContainText("5");
        await expect(kpi(page, "Errors")).toContainText("5");
        await expect(widget(page, "By level")).toContainText("5 events");
    });
});
