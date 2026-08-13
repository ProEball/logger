import { expect, test } from "@playwright/test";
import { withDb } from "@/e2e/support/db";
import { resetDb } from "@/e2e/support/cleanup";
import { bootstrapOrg, login, inviteMember, acceptInvite } from "@/e2e/support/auth";
import { getInviteToken } from "@/e2e/support/invitations";

const ORG_SLUG = "invite-corp";
const ALICE_EMAIL = "alice@invite.test";
const ALICE_PASS = "AlicePass99!";

test.describe("Invitation flow", () => {
    let bobInviteToken: string;
    let charlieInviteToken: string;

    test.beforeAll(async ({ browser }) => {
        await resetDb();

        // ── Alice runs setup wizard ───────────────────────────────────────
        const setupCtx = await browser.newContext();
        const setupPage = await setupCtx.newPage();
        await bootstrapOrg(setupPage, {
            orgName: "Invite Corp",
            ownerName: "Alice Owner",
            email: ALICE_EMAIL,
            password: ALICE_PASS,
            orgSlug: ORG_SLUG,
        });
        await setupCtx.close();

        // ── Alice invites Bob and Charlie ─────────────────────────────────
        const aliceCtx = await browser.newContext();
        const alicePage = await aliceCtx.newPage();
        await login(alicePage, ALICE_EMAIL, ALICE_PASS, ORG_SLUG);
        for (const email of ["bob@invite.test", "charlie@invite.test"]) {
            await inviteMember(alicePage, ORG_SLUG, email);
        }
        await aliceCtx.close();

        bobInviteToken = await getInviteToken("bob@invite.test");
        charlieInviteToken = await getInviteToken("charlie@invite.test");

        // ── Bob registers via invite link ─────────────────────────────────
        const bobCtx = await browser.newContext();
        const bobPage = await bobCtx.newPage();
        await acceptInvite(bobPage, bobInviteToken, "Bob Member", "BobPass99!", ORG_SLUG);
        await bobCtx.close();
    });

    test("invalid invite token shows error page", async ({ page }) => {
        await page.goto("/invite/invalid-token-xyz");
        await page.waitForLoadState("networkidle");
        await expect(
            page.getByRole("heading", { name: "Invitation not found" }),
        ).toBeVisible();
    });

    test("Bob is a member of the org after registering via invite link", async () => {
        const { rows } = await withDb((c) =>
            c.query(
                `SELECT u.email
                 FROM users u
                 JOIN organization_members om ON om.user_id = u.id
                 JOIN organizations o ON o.id = om.organization_id AND o.slug = $1
                 WHERE u.email = 'bob@invite.test'`,
                [ORG_SLUG],
            ),
        );
        expect(rows).toHaveLength(1);
    });

    test("Bob appears in Alice's team list", async ({ page }) => {
        await login(page, ALICE_EMAIL, ALICE_PASS, ORG_SLUG);
        await page.goto(`/${ORG_SLUG}/team`);
        await page.waitForLoadState("networkidle");
        await expect(page.getByText("Bob Member")).toBeVisible();
    });

    test("accepted invite token is no longer usable", async ({ page }) => {
        await page.goto(`/invite/${bobInviteToken}`);
        await page.waitForLoadState("networkidle");
        await expect(
            page.getByRole("heading", { name: "Invitation not found" }),
        ).toBeVisible();
    });

    test("Alice can revoke a pending invitation", async ({ page }) => {
        await login(page, ALICE_EMAIL, ALICE_PASS, ORG_SLUG);
        await page.goto(`/${ORG_SLUG}/team`);
        await page.waitForLoadState("networkidle");

        // Revoke Charlie's invitation
        const revokeBtn = page.getByRole("button", { name: "Revoke" }).first();
        await revokeBtn.waitFor({ timeout: 5_000 });
        await revokeBtn.click();

        // charlie@invite.test should disappear from the pending list
        await page.waitForFunction(
            () =>
                !Array.from(document.querySelectorAll("td")).some(
                    (td) => td.textContent === "charlie@invite.test",
                ),
            { timeout: 10_000 },
        );

        const { rows } = await withDb((c) =>
            c.query(`SELECT id FROM invitations WHERE token = $1`, [charlieInviteToken]),
        );
        expect(rows).toHaveLength(0);
    });
});
