"use server";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/core/auth/server";
import { db } from "@/core/db/client";
import { invitations } from "@/core/db/schema";
import { assertPermission } from "@/shared/permissions/guards";
import {
    getMembership,
    getOrgBySlug,
} from "@/features/organizations/services/organizations.service";

export async function revokeInvitationAction(
    invitationId: string,
    orgSlug: string,
): Promise<{ error?: string }> {
    const user = await getCurrentUser();
    if (!user) return { error: "Not authenticated." };

    const org = await getOrgBySlug(orgSlug);
    if (!org) return { error: "Organization not found." };

    const membership = await getMembership(user.id, org.id);
    try {
        assertPermission(membership, "members.invite");
    } catch {
        return { error: "You don't have permission to revoke invitations." };
    }

    await db
        .delete(invitations)
        .where(
            and(
                eq(invitations.id, invitationId),
                eq(invitations.organizationId, org.id),
            ),
        );

    revalidatePath(`/${orgSlug}/team`);
    return {};
}
