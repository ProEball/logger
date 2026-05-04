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
): Promise<void> {
    const user = await getCurrentUser();
    if (!user) return;

    const org = await getOrgBySlug(orgSlug);
    if (!org) return;

    const membership = await getMembership(user.id, org.id);
    try {
        assertPermission(membership, "members.invite");
    } catch {
        return;
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
}
