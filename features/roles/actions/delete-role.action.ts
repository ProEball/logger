"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser } from "@/core/auth/server";
import { db } from "@/core/db/client";
import { roles } from "@/core/db/schema";
import { getMembership, getOrgBySlug } from "@/features/organizations/services/organizations.service";
import { assertOwner } from "@/shared/permissions/guards";

const schema = z.object({
    orgSlug: z.string().min(1),
    roleId: z.string().uuid(),
});

export async function deleteRoleAction(data: {
    orgSlug: string;
    roleId: string;
}): Promise<{ error?: string }> {
    const parsed = schema.safeParse(data);
    if (!parsed.success) return { error: "Invalid input." };

    const user = await getCurrentUser();
    if (!user) return { error: "Not authenticated." };

    const org = await getOrgBySlug(parsed.data.orgSlug);
    if (!org) return { error: "Organization not found." };

    const membership = await getMembership(user.id, org.id);
    try {
        assertOwner(membership);
    } catch {
        return { error: "Owner access required." };
    }

    const [existing] = await db
        .select({ id: roles.id, isSystem: roles.isSystem })
        .from(roles)
        .where(and(eq(roles.id, parsed.data.roleId), eq(roles.organizationId, org.id)))
        .limit(1);

    if (!existing) return { error: "Role not found." };
    if (existing.isSystem) return { error: "System roles cannot be deleted." };

    try {
        await db.delete(roles).where(eq(roles.id, parsed.data.roleId));
        revalidatePath(`/${parsed.data.orgSlug}/settings/roles`);
        return {};
    } catch (err: unknown) {
        // FK RESTRICT fires when members or invitations still reference this role.
        if (
            err instanceof Error &&
            (err.message.includes("foreign key") || err.message.includes("restrict"))
        ) {
            return {
                error: "Cannot delete this role — members or pending invites are still assigned to it. Reassign them first.",
            };
        }
        return { error: "Failed to delete role." };
    }
}
