import { withDb } from "@/e2e/support/db";

export async function getInviteToken(email: string): Promise<string> {
    const { rows } = await withDb((c) =>
        c.query(
            `SELECT token FROM invitations WHERE email = $1
             AND accepted_at IS NULL ORDER BY created_at DESC LIMIT 1`,
            [email],
        ),
    );
    if (!rows[0]) throw new Error(`No pending invite for ${email}`);
    return rows[0].token as string;
}
