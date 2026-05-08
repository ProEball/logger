import type { Permission } from "./registry";

export interface Membership {
    isOwner: boolean;
    role: {
        permissions: string[];
    };
}

export function hasPermission(membership: Membership, perm: Permission): boolean {
    if (membership.isOwner) return true;
    return membership.role.permissions.includes(perm);
}
