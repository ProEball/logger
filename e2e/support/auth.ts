import type { Page } from "@playwright/test";

export interface BootstrapOptions {
    orgName: string;
    ownerName: string;
    email: string;
    password: string;
    orgSlug: string;
}

/** Runs the first-run setup wizard, creating the owner user, org, and system roles. */
export async function bootstrapOrg(page: Page, opts: BootstrapOptions): Promise<void> {
    await page.goto("/");
    await page.waitForURL("**/setup");
    await page.waitForLoadState("networkidle");

    await page.fill('input[placeholder="Acme Inc."]', opts.orgName);
    await page.keyboard.press("Tab");
    await page.fill('input[placeholder="Jane Smith"]', opts.ownerName);
    await page.keyboard.press("Tab");
    await page.fill('input[placeholder="jane@example.com"]', opts.email);
    await page.keyboard.press("Tab");
    // Two password fields on this form (Password, Confirm password) — select by order.
    const passwordInputs = page.locator('input[type="password"]');
    await passwordInputs.nth(0).fill(opts.password);
    await page.keyboard.press("Tab");
    await passwordInputs.nth(1).fill(opts.password);
    await page.keyboard.press("Tab");
    await page.click('button[type="submit"]');
    await page.waitForURL(`**/${opts.orgSlug}`, { timeout: 15_000 });
}

/** Logs in an existing user through the real /login form. */
export async function login(page: Page, email: string, password: string, orgSlug: string): Promise<void> {
    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    await page.fill('input[type="email"]', email);
    await page.keyboard.press("Tab");
    await page.fill('input[type="password"]', password);
    await page.keyboard.press("Tab");
    await page.click('button[type="submit"]');
    await page.waitForURL(`**/${orgSlug}`, { timeout: 15_000 });
}

/** From the team page, invites a member by email through the real UI dialog. */
export async function inviteMember(page: Page, orgSlug: string, email: string): Promise<void> {
    await page.goto(`/${orgSlug}/team`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Invite member" }).click();
    await page.getByRole("dialog").waitFor({ timeout: 5_000 });
    await page.fill('input[type="email"]', email);
    await page.keyboard.press("Tab");
    await page.getByRole("button", { name: "Send invitation" }).click();
    await page
        .getByRole("heading", { name: "Invitation created" })
        .waitFor({ timeout: 10_000 });
    await page.getByRole("button", { name: "Done" }).click();
}

/** Accepts a pending invite token, creating the invited user's account. */
export async function acceptInvite(
    page: Page,
    token: string,
    name: string,
    password: string,
    orgSlug: string,
): Promise<void> {
    await page.goto(`/invite/${token}`);
    await page.waitForLoadState("networkidle");
    await page
        .getByRole("heading", { name: "Create your account" })
        .waitFor({ timeout: 5_000 });
    await page.fill('input[placeholder="Jane Smith"]', name);
    await page.keyboard.press("Tab");
    await page.fill('input[type="password"]', password);
    await page.keyboard.press("Tab");
    await page.getByRole("button", { name: "Create account & join" }).click();
    await page.waitForURL(`**/${orgSlug}`, { timeout: 15_000 });
}
