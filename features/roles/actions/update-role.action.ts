"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser } from "@/core/auth/server";
import { db } from "@/core/db/client";
import { roles } from "@/core/db/schema";
import { getMembership, getOrgBySlug } from "@/features/organizations/services/organizations.service";
import { assertOwner } from "@/shared/permissions/guards";
import { OWNER_ONLY_PERMISSIONS, PERMISSIONS } from "@/shared/permissions/registry";
import type { Permission } from "@/shared/permissions/registry";

const ASSIGNABLE = (Object.keys(PERMISSIONS) as Permission[]).filter(
    (p) => !OWNER_ONLY_PERMISSIONS.has(p),
) as [Permission, ...Permission[]];

const schema = z.object({
    orgSlug: z.string().min(1),
    roleId: z.string().uuid(),
    name: z.string().min(1, "Name is required").max(50, "Name must be 50 characters or fewer"),
    description: z.string().max(200, "Description must be 200 characters or fewer").optional(),
    permissions: z.array(z.enum(ASSIGNABLE)),
});

export async function updateRoleAction(data: {
    orgSlug: string;
    roleId: string;
    name: string;
    description?: string;
    permissions: Permission[];
}): Promise<{ error?: string }> {
    const parsed = schema.safeParse(data);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

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

    // System roles: permissions and description can change, but name is locked.
    const patch: Partial<{
        name: string;
        description: string | null;
        permissions: string[];
        updatedAt: Date;
    }> = {
        description: parsed.data.description ?? null,
        permissions: parsed.data.permissions,
        updatedAt: new Date(),
    };
    if (!existing.isSystem) {
        patch.name = parsed.data.name;
    }

    try {
        await db.update(roles).set(patch).where(eq(roles.id, parsed.data.roleId));
        revalidatePath(`/${parsed.data.orgSlug}/settings/roles`);
        return {};
    } catch (err: unknown) {
        if (err instanceof Error && err.message.includes("unique")) {
            return { error: `A role named "${parsed.data.name}" already exists.` };
        }
        return { error: "Failed to update role." };
    }
}
