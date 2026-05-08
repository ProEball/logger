import { and, eq } from "drizzle-orm";
import { db } from "@/core/db/client";
import { roles } from "@/core/db/schema";
import type { Permission } from "@/shared/permissions/registry";

export type OrgRole = {
    id: string;
    name: string;
    description: string | null;
    permissions: Permission[];
    isSystem: boolean;
    isDefault: boolean;
    createdAt: Date;
};

export async function getOrgRoles(organizationId: string): Promise<OrgRole[]> {
    const rows = await db
        .select({
            id: roles.id,
            name: roles.name,
            description: roles.description,
            permissions: roles.permissions,
            isSystem: roles.isSystem,
            isDefault: roles.isDefault,
            createdAt: roles.createdAt,
        })
        .from(roles)
        .where(eq(roles.organizationId, organizationId));

    // Cast is safe: DB stores only valid Permission strings (enforced at write time)
    return rows as OrgRole[];
}

export async function getRoleById(
    id: string,
    organizationId: string,
): Promise<OrgRole | null> {
    const [row] = await db
        .select({
            id: roles.id,
            name: roles.name,
            description: roles.description,
            permissions: roles.permissions,
            isSystem: roles.isSystem,
            isDefault: roles.isDefault,
            createdAt: roles.createdAt,
        })
        .from(roles)
        .where(and(eq(roles.id, id), eq(roles.organizationId, organizationId)))
        .limit(1);

    if (!row) return null;
    return row as OrgRole;
}
