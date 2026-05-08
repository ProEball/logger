"use server";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser } from "@/core/auth/server";
import { db } from "@/core/db/client";
import { organizationMembers, roles } from "@/core/db/schema";
import { assertPermission } from "@/shared/permissions/guards";
import {
    getMembership,
    getOrgBySlug,
} from "@/features/organizations/services/organizations.service";

const schema = z.object({
    orgSlug: z.string().min(1),
    targetUserId: z.string().min(1),
    newRoleId: z.string().uuid(),
});

export async function changeMemberRoleAction(data: {
    orgSlug: string;
    targetUserId: string;
    newRoleId: string;
}): Promise<{ error?: string }> {
    const parsed = schema.safeParse(data);
    if (!parsed.success) return { error: "Invalid input." };

    const user = await getCurrentUser();
    if (!user) return { error: "Not authenticated." };

    const org = await getOrgBySlug(parsed.data.orgSlug);
    if (!org) return { error: "Organization not found." };

    const membership = await getMembership(user.id, org.id);
    try {
        assertPermission(membership, "members.role.assign");
    } catch {
        return { error: "You don't have permission to change member roles." };
    }

    const [target] = await db
        .select({ isOwner: organizationMembers.isOwner })
        .from(organizationMembers)
        .where(
            and(
                eq(organizationMembers.organizationId, org.id),
                eq(organizationMembers.userId, parsed.data.targetUserId),
            ),
        )
        .limit(1);
    if (!target) return { error: "Member not found." };
    if (target.isOwner) return { error: "Cannot change the role of an owner." };

    const [role] = await db
        .select({ id: roles.id })
        .from(roles)
        .where(and(eq(roles.id, parsed.data.newRoleId), eq(roles.organizationId, org.id)))
        .limit(1);
    if (!role) return { error: "Invalid role." };

    await db
        .update(organizationMembers)
        .set({ roleId: parsed.data.newRoleId })
        .where(
            and(
                eq(organizationMembers.organizationId, org.id),
                eq(organizationMembers.userId, parsed.data.targetUserId),
            ),
        );

    revalidatePath(`/${parsed.data.orgSlug}/team`);
    return {};
}
