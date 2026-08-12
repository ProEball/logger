import { OWNER_ONLY_PERMISSIONS } from "@/shared/permissions/registry";
import type { Permission } from "@/shared/permissions/registry";
import { PERMISSION_GROUP_ORDER, PERMISSION_GROUPS } from "@/shared/permissions/groups";
import type { PermissionGroupKey } from "@/shared/permissions/groups";

export interface AssignablePermissionGroup {
    key: PermissionGroupKey;
    label: string;
    permissions: Permission[];
}

// Permission groups filtered down to permissions any role can hold — owner-only
// permissions (org.delete, roles.manage) never appear in a role's UI.
export const ASSIGNABLE_PERMISSION_GROUPS: readonly AssignablePermissionGroup[] =
    PERMISSION_GROUP_ORDER.map((key) => {
        const group = PERMISSION_GROUPS[key];
        return {
            key,
            label: group.label,
            permissions: group.permissions.filter((p) => !OWNER_ONLY_PERMISSIONS.has(p)),
        };
    }).filter((group) => group.permissions.length > 0);

export const ASSIGNABLE_PERMISSIONS: readonly Permission[] = ASSIGNABLE_PERMISSION_GROUPS.flatMap(
    (group) => group.permissions,
);
