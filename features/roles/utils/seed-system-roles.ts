import { db } from "@/core/db/client";
import { roles } from "@/core/db/schema";
import { OWNER_ONLY_PERMISSIONS, PERMISSIONS } from "@/shared/permissions/registry";
import type { Permission } from "@/shared/permissions/registry";
import type { PgDatabase } from "drizzle-orm/pg-core";

export interface SeededRoleIds {
    adminRoleId: string;
    memberRoleId: string;
    viewerRoleId: string;
}

type SystemRoleDef = {
    name: string;
    description: string;
    permissions: Permission[];
    isSystem: true;
    isDefault: boolean;
};

const ALL_ASSIGNABLE: Permission[] = (Object.keys(PERMISSIONS) as Permission[]).filter(
    (p) => !OWNER_ONLY_PERMISSIONS.has(p),
);

const READ_ONLY: Permission[] = (Object.keys(PERMISSIONS) as Permission[]).filter((p) =>
    p.endsWith(".read"),
);

const MEMBER_DEFAULT: Permission[] = [
    "org.read",
    "members.read",
    "projects.read",
    "events.read",
    "alerts.read",
    "api_keys.read",
];

export const SYSTEM_ROLE_DEFS: readonly SystemRoleDef[] = [
    {
        name: "Admin",
        description: "Full access except org deletion and role management",
        permissions: ALL_ASSIGNABLE,
        isSystem: true,
        isDefault: false,
    },
    {
        name: "Member",
        description: "Standard member access",
        permissions: MEMBER_DEFAULT,
        isSystem: true,
        isDefault: true,
    },
    {
        name: "Viewer",
        description: "Read-only access to all resources",
        permissions: READ_ONLY,
        isSystem: true,
        isDefault: false,
    },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function seedSystemRoles(
    organizationId: string,
    // PgDatabase<any, any, any> accepts both the db instance and transaction objects
    database: PgDatabase<any, any, any> = db,
): Promise<SeededRoleIds> {
    const inserted = await database
        .insert(roles)
        .values(SYSTEM_ROLE_DEFS.map((def) => ({ ...def, organizationId })))
        .returning({ id: roles.id, name: roles.name });

    const byName = Object.fromEntries(inserted.map((r) => [r.name, r.id]));

    return {
        adminRoleId: byName["Admin"] as string,
        memberRoleId: byName["Member"] as string,
        viewerRoleId: byName["Viewer"] as string,
    };
}
