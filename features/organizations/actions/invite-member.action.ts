"use server";
import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser } from "@/core/auth/server";
import { db } from "@/core/db/client";
import { invitations, organizationMembers, roles, users } from "@/core/db/schema";
import { env } from "@/core/env";
import { assertPermission } from "@/shared/permissions/guards";
import {
    getMembership,
    getOrgBySlug,
} from "@/features/organizations/services/organizations.service";

const schema = z.object({
    orgSlug: z.string().min(1),
    email: z.string().email(),
    roleId: z.string().uuid(),
});

type Result = { inviteUrl: string } | { error: string };

export async function inviteMemberAction(data: {
    orgSlug: string;
    email: string;
    roleId: string;
}): Promise<Result> {
    const parsed = schema.safeParse(data);
    if (!parsed.success) return { error: "Invalid input." };

    const user = await getCurrentUser();
    if (!user) return { error: "Not authenticated." };

    const org = await getOrgBySlug(parsed.data.orgSlug);
    if (!org) return { error: "Organization not found." };

    const membership = await getMembership(user.id, org.id);
    try {
        assertPermission(membership, "members.invite");
    } catch {
        return { error: "You don't have permission to invite members." };
    }

    // Verify roleId belongs to this org
    const [role] = await db
        .select({ id: roles.id })
        .from(roles)
        .where(and(eq(roles.id, parsed.data.roleId), eq(roles.organizationId, org.id)))
        .limit(1);
    if (!role) return { error: "Invalid role." };

    // Check for existing pending invite
    const [existingInvite] = await db
        .select({ id: invitations.id })
        .from(invitations)
        .where(
            and(
                eq(invitations.organizationId, org.id),
                eq(invitations.email, parsed.data.email),
                isNull(invitations.acceptedAt),
            ),
        )
        .limit(1);
    if (existingInvite) return { error: "A pending invitation for this email already exists." };

    // Check if already a member
    const [existingMember] = await db
        .select({ userId: users.id })
        .from(users)
        .innerJoin(
            organizationMembers,
            and(
                eq(organizationMembers.userId, users.id),
                eq(organizationMembers.organizationId, org.id),
            ),
        )
        .where(eq(users.email, parsed.data.email))
        .limit(1);
    if (existingMember) return { error: "This user is already a member." };

    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await db.insert(invitations).values({
        organizationId: org.id,
        email: parsed.data.email,
        roleId: parsed.data.roleId,
        token,
        expiresAt,
        invitedBy: user.id,
    });

    revalidatePath(`/${parsed.data.orgSlug}/team`);
    return { inviteUrl: `${env.APP_URL}/invite/${token}` };
}
