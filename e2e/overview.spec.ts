import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "crypto";
import { withDb } from "@/e2e/support/db";
import { resetDb } from "@/e2e/support/cleanup";
import { bootstrapOrg, login } from "@/e2e/support/auth";
import { generateApiKey, extractKeyPrefix, hashApiKey } from "@/e2e/support/api-keys";
import { BASE_URL } from "@/e2e/support/env";

/**
 * Organization overview (`/[org]`).
 *
 * Added 2026-08-20 for PLAN.md §16.1 Stage B. The page was rendered on every
 * `login()` in every spec but nothing had ever asserted its contents, so it
 * could have shown zeros — or the wrong numbers — and the whole suite would
 * still have passed. It is also the page Stage D rewrites for streaming and
 * caching, which is precisely when "renders without throwing" stops being a
 * useful thing to know.
 *
 * The event counts below are chosen, not arbitrary: 10 and 9 straddle the
 * point where ordering a stringified count lexicographically stops agreeing
 * with ordering it numerically. See the "orders top errors by count" test.
 */

const ORG_SLUG = "ovw-corp";
const EMAIL = "alice@ovw.test";
const PASS = "AlicePass99!";

const ALPHA_SLUG = "ovw-alpha";
const BETA_SLUG = "ovw-beta";
const QUIET_SLUG = "ovw-quiet";

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

async function seedEvents(
    apiKey: string,
    count: number,
    event: Record<string, unknown>,
): Promise<void> {
    const batch = Array.from({ length: count }, () => ({ ...event }));
    const res = await fetch(`${BASE_URL}/api/ingest/batch`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(batch),
    });
    if (!res.ok) throw new Error(`Ingest failed: ${res.status} ${await res.text()}`);
}

/** Open the overview and wait for the server-rendered KPI row to be present. */
async function openOverview(page: Page, query = ""): Promise<void> {
    await page.goto(`/${ORG_SLUG}${query}`);
    await expect(page.getByRole("group", { name: "Total events" })).toBeVisible();
}

/**
 * The projects section, scoped away from the sidebar — which links to the same
 * projects by the same names, so an unscoped link query matches twice.
 */
function projectsSection(page: Page) {
    return page.getByRole("group", { name: "Projects", exact: true });
}

let orgId: string;
let alpha: ProjectCtx;
let beta: ProjectCtx;

test.describe.serial("Organization overview", () => {
    test.beforeAll(async ({ browser }) => {
        await resetDb();

        const setupCtx = await browser.newContext();
        const setupPage = await setupCtx.newPage();
        await bootstrapOrg(setupPage, {
            orgName: "Ovw Corp",
            ownerName: "Alice Owner",
            email: EMAIL,
            password: PASS,
            orgSlug: ORG_SLUG,
        });
        await setupCtx.close();

        const { rows } = await withDb((c) =>
            c.query("SELECT id FROM organizations WHERE slug = $1", [ORG_SLUG]),
        );
        orgId = rows[0].id;

        alpha = await seedProject(orgId, "Ovw Alpha", ALPHA_SLUG);
        beta = await seedProject(orgId, "Ovw Beta", BETA_SLUG);
        // Deliberately left without events — a quiet project must still appear.
        await seedProject(orgId, "Ovw Quiet", QUIET_SLUG);

        // Alpha: 23 events, 11 of them error or fatal.
        await seedEvents(alpha.apiKey, 12, {
            level: "info",
            message: "alpha routine",
            environment: "production",
        });
        await seedEvents(alpha.apiKey, 10, {
            level: "error",
            message: "alpha boom",
            environment: "production",
        });
        await seedEvents(alpha.apiKey, 1, {
            level: "fatal",
            message: "alpha meltdown",
            environment: "staging",
        });

        // Beta: 17 events, 9 of them error. No environment on the first two
        // groups, so the org environment list also has to cover "(unset)".
        await seedEvents(beta.apiKey, 6, { level: "info", message: "beta routine" });
        await seedEvents(beta.apiKey, 2, { level: "warn", message: "beta warning" });
        await seedEvents(beta.apiKey, 9, {
            level: "error",
            message: "beta boom",
            environment: "staging",
        });
    });

    test.beforeEach(async ({ page }) => {
        await login(page, EMAIL, PASS, ORG_SLUG);
    });

    // ── KPI row ──────────────────────────────────────────────────────────────

    test("sums events across every project in the organization", async ({ page }) => {
        await openOverview(page);
        // 23 from Alpha + 17 from Beta + 0 from Quiet.
        await expect(page.getByRole("group", { name: "Total events" })).toContainText("40");
    });

    test("counts fatal alongside error in the errors KPI", async ({ page }) => {
        await openOverview(page);
        // 10 alpha errors + 1 alpha fatal + 9 beta errors.
        await expect(page.getByRole("group", { name: "Errors and fatals" })).toContainText("20");
    });

    test("counts a project with no events as a project", async ({ page }) => {
        await openOverview(page);
        await expect(page.getByRole("group", { name: "Projects count" })).toContainText("3");
    });

    test("reports no firing alerts when the org has no alert rules", async ({ page }) => {
        await openOverview(page);
        const card = page.getByRole("group", { name: "Firing alerts" });
        await expect(card).toContainText("0 rules total");
    });

    // ── Projects ─────────────────────────────────────────────────────────────

    test("lists every project, including the one with no events", async ({ page }) => {
        await openOverview(page);
        const cards = projectsSection(page);
        await expect(cards.getByRole("link", { name: /Ovw Alpha/ })).toBeVisible();
        await expect(cards.getByRole("link", { name: /Ovw Beta/ })).toBeVisible();
        await expect(cards.getByRole("link", { name: /Ovw Quiet/ })).toBeVisible();
    });

    test("shows per-project totals in the table view", async ({ page }) => {
        await openOverview(page);
        await projectsSection(page).getByRole("button", { name: "Table", exact: true }).click();

        const alphaRow = projectsSection(page).getByRole("row", { name: /Ovw Alpha/ });
        await expect(alphaRow.getByRole("cell").nth(1)).toHaveText("23");
        await expect(alphaRow.getByRole("cell").nth(2)).toHaveText("11");

        const betaRow = projectsSection(page).getByRole("row", { name: /Ovw Beta/ });
        await expect(betaRow.getByRole("cell").nth(1)).toHaveText("17");
        await expect(betaRow.getByRole("cell").nth(2)).toHaveText("9");
    });

    test("shows zeros rather than blanks for a project with no events", async ({ page }) => {
        await openOverview(page);
        await projectsSection(page).getByRole("button", { name: "Table", exact: true }).click();

        const quietRow = projectsSection(page).getByRole("row", { name: /Ovw Quiet/ });
        await expect(quietRow.getByRole("cell").nth(1)).toHaveText("0");
        await expect(quietRow.getByRole("cell").nth(2)).toHaveText("0");
        // Error rate is undefined at zero events and must not render "NaN%".
        await expect(quietRow.getByRole("cell").nth(3)).toHaveText("—");
    });

    // ── Top errors ───────────────────────────────────────────────────────────

    test("orders top errors by count, not by the text of the count", async ({ page }) => {
        await openOverview(page);
        const items = page.getByRole("group", { name: "Top errors across org" }).getByRole("listitem");

        // 10 > 9 > 1. Sorting the stringified counts instead puts "9" first,
        // because "9" > "10" lexicographically — which is what this asserts
        // against. The same slip decides *which* rows survive the LIMIT 5.
        await expect(items.nth(0)).toContainText("alpha boom");
        await expect(items.nth(1)).toContainText("beta boom");
        await expect(items.nth(2)).toContainText("alpha meltdown");
    });

    test("says which window the top errors cover", async ({ page }) => {
        await openOverview(page, "?range=1h");
        await expect(page.getByRole("group", { name: "Top errors across org" })).toContainText("last 1h");
    });

    test("caps its own window when the page asks for a wider range", async ({ page }) => {
        // This widget reads raw events — the one query that cannot come from
        // the rollup — so its cost is proportional to the errors it scans. A
        // 30-day page range must not drag it along, and the difference has to
        // be visible or the figures become quietly incomparable.
        await openOverview(page, "?range=30d");

        const card = page.getByRole("group", { name: "Top errors across org" });
        await expect(card).toContainText("last 24h");
        await expect(card).not.toContainText("last 30d");
        // Capping the window must not empty the widget.
        await expect(card.getByRole("listitem").first()).toBeVisible();
    });

    test("attributes each top error to its project", async ({ page }) => {
        await openOverview(page);
        const items = page.getByRole("group", { name: "Top errors across org" }).getByRole("listitem");
        await expect(items.nth(0)).toContainText("Ovw Alpha");
        await expect(items.nth(1)).toContainText("Ovw Beta");
    });

    test("excludes non-error levels from top errors", async ({ page }) => {
        await openOverview(page);
        const card = page.getByRole("group", { name: "Top errors across org" });
        await expect(card).not.toContainText("alpha routine");
        await expect(card).not.toContainText("beta warning");
    });

    // ── Level breakdown ──────────────────────────────────────────────────────

    test("breaks down every ingested level and totals them", async ({ page }) => {
        await openOverview(page);
        const card = page.getByRole("group", { name: "Level breakdown" });
        await expect(card).toContainText("40 total");
        // Rendered in severity order, and only levels that occurred.
        const items = card.getByRole("listitem");
        await expect(items).toHaveCount(4);
        await expect(items.nth(0)).toContainText("fatal");
        await expect(items.nth(1)).toContainText("error");
        await expect(items.nth(2)).toContainText("warn");
        await expect(items.nth(3)).toContainText("info");
        await expect(card).not.toContainText("debug");
    });

    // ── Filters ──────────────────────────────────────────────────────────────

    test("changing the range preset keeps the totals for a range that covers everything", async ({ page }) => {
        await openOverview(page);
        await page.getByRole("group", { name: "Time range" }).getByRole("button", { name: "24h" }).click();
        await page.waitForURL(/range=24h/);
        await expect(page.getByRole("group", { name: "Total events" })).toContainText("40");
    });

    test("offers no level filter", async ({ page }) => {
        // Removed 2026-08-20. The chips narrowed three of the page's eight
        // widgets and left five visibly unchanged, which reads as a broken
        // filter rather than one with a documented scope — reasoning in
        // `DashboardFilterBar.tsx`. Asserting their absence is what stops them
        // reappearing by habit.
        await openOverview(page);
        await expect(page.getByRole("group", { name: "Levels" })).toHaveCount(0);
    });

    test("filtering by environment narrows the totals to that environment", async ({ page }) => {
        await openOverview(page);
        await page
            .getByRole("group", { name: "Environments" })
            .getByRole("button", { name: "production" })
            .click();
        await page.waitForURL(/env=production/);
        // Alpha's 12 info + 10 error events carry environment=production.
        await expect(page.getByRole("group", { name: "Total events" })).toContainText("22");
    });

    test("offers every environment seen in the org, including unset", async ({ page }) => {
        await openOverview(page);
        const envs = page.getByRole("group", { name: "Environments" });
        await expect(envs.getByRole("button", { name: "production" })).toBeVisible();
        await expect(envs.getByRole("button", { name: "staging" })).toBeVisible();
        await expect(envs.getByRole("button", { name: "(unset)" })).toBeVisible();
    });

    test("falls back to the default range for a preset that does not exist", async ({ page }) => {
        await openOverview(page, "?range=99d");
        // The default 1h range still covers everything seeded in this run.
        await expect(page.getByRole("group", { name: "Total events" })).toContainText("40");
    });

    test("ignores a stale `levels` param left in a bookmarked URL", async ({ page }) => {
        // The predecessor of this test pinned a real defect: the level filter
        // reached the stats query but not the top-message query, so filtering
        // to `info` showed a project with zero errors and an error message
        // beside it. Removing the filter removed the disagreement rather than
        // resolving it, so the test that pinned it is gone too.
        //
        // What replaces it is the property that removal has to hold: a URL
        // someone bookmarked while the chips existed must now narrow nothing,
        // rather than half-narrowing the page it used to.
        await openOverview(page, "?levels=info");

        await expect(page.getByRole("group", { name: "Total events" })).toContainText("40");
    });
});
