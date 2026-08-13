import { expect, test } from "@playwright/test";
import { resetDb } from "@/e2e/support/cleanup";
import { bootstrapOrg, login, inviteMember, acceptInvite } from "@/e2e/support/auth";
import { getInviteToken } from "@/e2e/support/invitations";
import { labelFor } from "@/e2e/support/ui";

const ORG_SLUG = "roles-corp";
const ALICE_EMAIL = "alice@roles.test";
const ALICE_PASS = "AlicePass99!";
const BOB_EMAIL = "bob@roles.test";
const BOB_PASS = "BobPass99!";

test.describe.serial("Role management — custom roles and permission enforcement", () => {
    test.beforeAll(async ({ browser }) => {
        await resetDb();

        // ── Alice runs setup wizard ───────────────────────────────────────
        const setupCtx = await browser.newContext();
        const setupPage = await setupCtx.newPage();
        await bootstrapOrg(setupPage, {
            orgName: "Roles Corp",
            ownerName: "Alice Owner",
            email: ALICE_EMAIL,
            password: ALICE_PASS,
            orgSlug: ORG_SLUG,
        });
        await setupCtx.close();

        // ── Alice invites Bob ─────────────────────────────────────────────
        const aliceCtx = await browser.newContext();
        const alicePage = await aliceCtx.newPage();
        await login(alicePage, ALICE_EMAIL, ALICE_PASS, ORG_SLUG);
        await inviteMember(alicePage, ORG_SLUG, BOB_EMAIL);
        await aliceCtx.close();

        // ── Bob registers via invite link ─────────────────────────────────
        const bobToken = await getInviteToken(BOB_EMAIL);
        const bobCtx = await browser.newContext();
        const bobPage = await bobCtx.newPage();
        await acceptInvite(bobPage, bobToken, "Bob Member", BOB_PASS, ORG_SLUG);
        await bobCtx.close();
    });

    test("owner can create a custom role with restricted permissions", async ({ page }) => {
        await login(page, ALICE_EMAIL, ALICE_PASS, ORG_SLUG);

        await page.goto(`/${ORG_SLUG}/settings/roles/new`);
        await page.waitForLoadState("networkidle");

        // Fill name using placeholder (Input component renders a plain <input>)
        await page.fill('input[placeholder="e.g. QA Engineer"]', "QA");

        // Check only "View organization" (org.read) and "Read events" (events.read).
        // Click the wrapping label — a decorative <span> overlays the native
        // input and would intercept a direct click on it.
        await labelFor(page, page.getByLabel("View organization")).click();
        await labelFor(page, page.getByLabel("Read events")).click();

        await page.getByRole("button", { name: "Create role" }).click();
        await page.waitForURL(`**/${ORG_SLUG}/settings/roles`, { timeout: 10_000 });
        await expect(page.getByText("QA")).toBeVisible();
    });

    test("owner can assign the custom role to a member", async ({ page }) => {
        await login(page, ALICE_EMAIL, ALICE_PASS, ORG_SLUG);

        await page.goto(`/${ORG_SLUG}/team`);
        await page.waitForLoadState("networkidle");

        const bobRow = page.getByRole("row").filter({ hasText: BOB_EMAIL });
        await bobRow.getByRole("button", { name: "Member actions" }).click();
        await page.getByRole("button", { name: "Change role" }).click();
        await page.getByRole("heading", { name: /Change role/ }).waitFor({ timeout: 5_000 });

        const roleSelect = page.locator("dialog[open] select");
        const options = await roleSelect.locator("option").all();
        let qaValue = "";
        for (const opt of options) {
            if ((await opt.textContent())?.includes("QA")) {
                qaValue = (await opt.getAttribute("value")) ?? "";
            }
        }
        expect(qaValue).not.toBe("");
        await roleSelect.selectOption(qaValue);

        await page.getByRole("button", { name: "Save" }).click();
        await page
            .getByRole("heading", { name: /Change role/ })
            .waitFor({ state: "hidden", timeout: 5_000 });

        await page.waitForLoadState("networkidle");
        const roleCell = page
            .getByRole("row")
            .filter({ hasText: BOB_EMAIL })
            .getByRole("cell")
            .nth(2);
        await expect(roleCell).toContainText("QA");
    });

    test("user with QA role can access the org overview", async ({ page }) => {
        await login(page, BOB_EMAIL, BOB_PASS, ORG_SLUG);
        // Should land on org overview (org.read in QA role)
        expect(page.url()).toContain(`/${ORG_SLUG}`);
    });

    test("user with QA role cannot access the members page", async ({ page }) => {
        await login(page, BOB_EMAIL, BOB_PASS, ORG_SLUG);

        await page.goto(`/${ORG_SLUG}/team`);
        await page.waitForLoadState("networkidle");

        // Proxy redirects away, or page shows a permission error
        const isForbidden =
            !page.url().includes("/team") ||
            (await page.locator('[role="alert"]').count()) > 0 ||
            (await page.content()).includes("permission");
        expect(isForbidden).toBe(true);
    });
});
