"use server";

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
    name: z.string().min(1, "Name is required").max(50, "Name must be 50 characters or fewer"),
    description: z.string().max(200, "Description must be 200 characters or fewer").optional(),
    permissions: z.array(z.enum(ASSIGNABLE)),
});

export async function createRoleAction(data: {
    orgSlug: string;
    name: string;
    description?: string;
    permissions: Permission[];
}): Promise<{ error?: string; roleId?: string }> {
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

    try {
        const [inserted] = await db
            .insert(roles)
            .values({
                organizationId: org.id,
                name: parsed.data.name,
                description: parsed.data.description ?? null,
                permissions: parsed.data.permissions,
                isSystem: false,
                isDefault: false,
            })
            .returning({ id: roles.id });

        revalidatePath(`/${parsed.data.orgSlug}/settings/roles`);
        return { roleId: inserted.id };
    } catch (err: unknown) {
        if (err instanceof Error && err.message.includes("unique")) {
            return { error: `A role named "${parsed.data.name}" already exists.` };
        }
        return { error: "Failed to create role." };
    }
}
