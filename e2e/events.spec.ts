import { expect, test } from "@playwright/test";
import { randomUUID } from "crypto";
import { withDb } from "@/e2e/support/db";
import { resetDb } from "@/e2e/support/cleanup";
import { bootstrapOrg, login } from "@/e2e/support/auth";
import { generateApiKey, extractKeyPrefix, hashApiKey } from "@/e2e/support/api-keys";
import { countEvents, withEvents } from "@/e2e/support/events";
import { BASE_URL } from "@/e2e/support/env";

const ORG_SLUG = "events-corp";
const EMAIL = "alice@events.test";
const PASS = "AlicePass99!";
const PROJECT_SLUG = "events-project";

interface Ctx {
    projectId: string;
    apiKey: string;
}

async function seedProject(orgId: string): Promise<Ctx> {
    const projectId = randomUUID();
    const apiKey = generateApiKey();
    await withDb(async (c) => {
        await c.query(
            `INSERT INTO projects (id, organization_id, name, slug) VALUES ($1, $2, $3, $4)`,
            [projectId, orgId, "Events Project", PROJECT_SLUG],
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
    overrides: Record<string, unknown> = {},
    message: (i: number) => string = (i) => `test event ${i}`,
): Promise<void> {
    const batch = Array.from({ length: count }, (_, i) => ({
        level: "info",
        message: message(i),
        ...overrides,
    }));
    const res = await fetch(`${BASE_URL}/api/ingest/batch`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(batch),
    });
    if (!res.ok) throw new Error(`Ingest failed: ${res.status}`);
}

let ctx: Ctx;

test.describe.serial("Events list", () => {
    test.beforeAll(async ({ browser }) => {
        await resetDb();

        const setupCtx = await browser.newContext();
        const setupPage = await setupCtx.newPage();
        await bootstrapOrg(setupPage, {
            orgName: "Events Corp",
            ownerName: "Alice Owner",
            email: EMAIL,
            password: PASS,
            orgSlug: ORG_SLUG,
        });
        await setupCtx.close();

        const { rows } = await withDb((c) => c.query("SELECT id FROM organizations WHERE slug = $1", [ORG_SLUG]));
        ctx = await seedProject(rows[0].id);

        // Seed 60 info events + 5 error events with stack trace.
        //
        // The errors carry an order id rather than an index, because
        // `order o_1000 failed` normalises to `order *** failed` and
        // `test event 0` does not — the normaliser keeps short bare numbers on
        // purpose (`returned 503` and `returned 500` are different problems).
        // One shared template is what makes the assertion below able to fail.
        await seedEvents(ctx.apiKey, 60, {});
        await seedEvents(
            ctx.apiKey,
            5,
            {
                level: "error",
                error_type: "TypeError",
                stack_trace: "TypeError: Cannot read properties of undefined\n    at Object.handler (app.js:10:5)\n    at Router.handle (router.js:20:3)",
                attributes: { user_id: "u_e2e_123" },
            },
            (i) => `order o_100${i} failed`,
        );
    });

    test("GET /[org]/[project]/events → shows events table", async ({ page }) => {
        await login(page, EMAIL, PASS, ORG_SLUG);
        await page.goto(`/${ORG_SLUG}/${PROJECT_SLUG}/events?range=7d`);
        await page.waitForSelector("table", { timeout: 10_000 });
        const rows = await page.locator("tbody tr").count();
        expect(rows).toBeGreaterThan(0);
    });

    test("filter panel loads its counts on open, not with the page", async ({ page }) => {
        // Added 2026-08-20 with the move to on-demand facets. The five facet
        // aggregations no longer run with the page, so nothing else in this
        // suite would notice if the panel came up permanently empty.
        await login(page, EMAIL, PASS, ORG_SLUG);
        await page.goto(`/${ORG_SLUG}/${PROJECT_SLUG}/events?range=7d`);
        await page.waitForSelector("table", { timeout: 10_000 });

        // Nothing facet-shaped exists before the panel is opened: the options
        // are checkboxes, and the page renders none of them.
        await expect(page.getByRole("checkbox")).toHaveCount(0);

        await page.getByRole("button", { name: /^Filters/ }).click();

        // After opening, the panel is populated from the server. Asserting on
        // the option checkboxes rather than on text keeps this from passing
        // against an empty panel — which is the only failure worth catching
        // here, and the one a text match would sail straight through.
        await expect(page.getByRole("checkbox").first()).toBeVisible({ timeout: 10_000 });
        // Seeded data yields at least: info + error levels, "(unset)" for
        // environment/source/release, and TypeError + "(unset)" error types.
        expect(await page.getByRole("checkbox").count()).toBeGreaterThan(3);
    });

    // The two tests below were added in Phase 3 of the ClickHouse migration.
    //
    // The gate for that phase was "events e2e green", and most of this file
    // would have stayed green regardless: six of its nine tests asserted
    // against Postgres directly (`SELECT … FROM events`) rather than through
    // the page, and the dual write kept those rows there whatever the read path
    // did. Only two tests actually went through the new path — the table above
    // and the facet panel — and neither touched the drawer or a filter.
    //
    // Phase 4 deleted the Postgres table, so those six now read ClickHouse
    // instead. That makes them honest about *which store* they are checking,
    // and no more of a page test than they were: they are ingest assertions,
    // kept because ingest has no other end-to-end coverage of the column types.
    // What actually gates the read path is the two tests below and the
    // 46-test integration file.

    test("filtering by level narrows the table to that level", async ({ page }) => {
        // The filter reaches ClickHouse as `level IN {p:Array(String)}` against
        // an Enum8. Nothing else in this suite would notice if that clause
        // stopped narrowing, or started matching nothing at all.
        await login(page, EMAIL, PASS, ORG_SLUG);
        await page.goto(`/${ORG_SLUG}/${PROJECT_SLUG}/events?range=7d&levels=error`);
        await page.waitForSelector("table", { timeout: 10_000 });

        await expect(page.locator("tbody tr")).toHaveCount(5);
    });

    test("clicking a row opens the drawer for that event", async ({ page }) => {
        // The only end-to-end exercise of `getEventById`: the click puts the id
        // and the timestamp in the URL and the server re-fetches the one row.
        // If that lookup returned null the drawer would not render at all.
        await login(page, EMAIL, PASS, ORG_SLUG);
        await page.goto(`/${ORG_SLUG}/${PROJECT_SLUG}/events?range=7d`);
        await page.waitForSelector("table", { timeout: 10_000 });

        await page.locator("tbody tr").first().click();
        await page.waitForURL(/[?&]event=/, { timeout: 10_000 });

        const id = new URL(page.url()).searchParams.get("event");
        expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/);

        // The id is rendered only inside the drawer — twice, in the header and
        // again in the details tab — so its presence says the single-event read
        // found the row rather than that the list did.
        await expect(page.getByText(id!, { exact: true }).first()).toBeVisible({ timeout: 10_000 });
        await expect(page.getByRole("button", { name: "Close" })).toBeVisible();
    });

    test("GET /api/ingest → events queryable after ingest", async ({ request }) => {
        // Verify events exist in DB via ingest endpoint
        const res = await request.post("/api/ingest", {
            headers: {
                "Authorization": `Bearer ${ctx.apiKey}`,
                "Content-Type": "application/json",
            },
            data: { level: "info", message: "E2E query check" },
        });
        expect(res.status()).toBe(202);
        const body = await res.json() as { id: string };
        expect(body.id).toMatch(/^[0-9a-f-]{36}$/);

        const rows = await withEvents<{ message: string }>(
            "SELECT message FROM events WHERE id = {id:UUID}",
            { id: body.id },
        );
        expect(rows[0]?.message).toBe("E2E query check");
    });

    test("ingest stored every event of the batch", async () => {
        // 60 info + 5 error + 1 from the previous test.
        expect(await countEvents("project_id = {p:UUID}", { p: ctx.projectId })).toBeGreaterThanOrEqual(65);
    });

    test("ingest stored the level as an Enum8 that reads back by name", async () => {
        const n = await countEvents("project_id = {p:UUID} AND level = 'error'", {
            p: ctx.projectId,
        });
        expect(n).toBe(5);
    });

    test("more than one page of events exists, so the cursor has something to do", async () => {
        const n = await countEvents(
            "project_id = {p:UUID} AND timestamp >= now64(3, 'UTC') - INTERVAL 7 DAY",
            { p: ctx.projectId },
        );
        expect(n).toBeGreaterThan(50);
    });

    test("an attribute is stored as a JSON path, addressable by key", async () => {
        // `getSubcolumn` with the key **bound** is what the filter compiler
        // emits, and it is the reason no attribute key from a URL is ever
        // spliced into SQL. This is the only end-to-end exercise of that shape.
        const n = await countEvents(
            "project_id = {p:UUID} AND toString(getSubcolumn(attributes, {k:String})) = {v:String}",
            { p: ctx.projectId, k: "user_id", v: "u_e2e_123" },
        );
        expect(n).toBe(5);
    });

    test("an absent optional field is stored blank, never null", async () => {
        // The schema has no Nullable column (§4.1), so "no stack trace" is the
        // empty string. A spec asserting `IS NOT NULL` would pass against every
        // row of a table that had lost the field entirely.
        const withTrace = await countEvents("project_id = {p:UUID} AND stack_trace != ''", {
            p: ctx.projectId,
        });
        const withoutTrace = await countEvents("project_id = {p:UUID} AND stack_trace = ''", {
            p: ctx.projectId,
        });

        expect(withTrace).toBe(5);
        expect(withoutTrace).toBeGreaterThanOrEqual(61);
    });

    test("ingest stored the message template beside the fingerprint", async () => {
        // Phase 4 moved the template text out of a Postgres registry and onto
        // the row. Nothing else in any e2e suite would notice if it stopped
        // being written — the dashboards would simply label every group with
        // its raw message and look plausible.
        const rows = await withEvents<{ message_template: string; n: string }>(
            `SELECT message_template, count() AS n
             FROM events WHERE project_id = {p:UUID} AND level = 'error'
             GROUP BY message_template`,
            { p: ctx.projectId },
        );

        expect(rows).toHaveLength(1);
        expect(rows[0].message_template).toBe("order *** failed");
        expect(Number(rows[0].n)).toBe(5);
    });

    test("OPTIONS /api/ingest → CORS headers", async ({ request }) => {
        const response = await request.fetch("/api/ingest", {
            method: "OPTIONS",
            headers: { "Origin": "https://example.com" },
        });
        expect(response.status()).toBe(204);
        expect(response.headers()["access-control-allow-origin"]).toBe("*");
    });
});
