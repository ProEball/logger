import { expect, test } from "@playwright/test";
import { withDb } from "@/e2e/support/db";
import { resetDb } from "@/e2e/support/cleanup";
import { bootstrapOrg } from "@/e2e/support/auth";

test.describe.serial("Auth bootstrap — setup wizard flow", () => {
    test.beforeAll(async () => {
        await resetDb();
    });

    test("unauthenticated root redirects to /setup when no users exist", async ({ page }) => {
        await page.goto("/");
        await page.waitForURL("**/setup");
    });

    test("setup wizard creates owner, org, and three system roles", async ({ page }) => {
        await bootstrapOrg(page, {
            orgName: "Bootstrap Corp",
            ownerName: "Alice Owner",
            email: "alice@bootstrap.test",
            password: "AlicePass99!",
            orgSlug: "bootstrap-corp",
        });

        const { users, orgs, members, roles } = await withDb(async (c) => {
            const { rows: users } = await c.query("SELECT id FROM users");
            const { rows: orgs } = await c.query("SELECT slug FROM organizations");
            const { rows: members } = await c.query("SELECT is_owner FROM organization_members");
            const { rows: roles } = await c.query("SELECT name FROM roles ORDER BY name");
            return { users, orgs, members, roles };
        });

        expect(users).toHaveLength(1);
        expect(orgs[0].slug).toBe("bootstrap-corp");
        expect(members[0].is_owner).toBe(true);
        expect(roles.map((r: { name: string }) => r.name)).toEqual(["Admin", "Member", "Viewer"]);
    });

    test("/setup returns 404 once an owner exists", async ({ page }) => {
        const response = await page.request.get("/setup");
        expect(response.status()).toBe(404);
    });

    test("navigating to /setup after bootstrap returns 404 in a real browser navigation", async ({ browser }) => {
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        const response = await page.goto("/setup");
        await ctx.close();

        expect(response?.status()).toBe(404);
    });
});
