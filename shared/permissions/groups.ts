import type { Permission } from "./registry";

export type PermissionGroupKey =
    | "organization"
    | "members"
    | "projects"
    | "events"
    | "alerts"
    | "api-keys";

export interface PermissionGroup {
    label: string;
    permissions: Permission[];
}

export const PERMISSION_GROUPS: Record<PermissionGroupKey, PermissionGroup> = {
    organization: {
        label: "Organization",
        permissions: ["org.read", "org.update", "org.delete"],
    },
    members: {
        label: "Members & Roles",
        permissions: [
            "members.read",
            "members.invite",
            "members.remove",
            "members.role.assign",
            "roles.manage",
        ],
    },
    projects: {
        label: "Projects",
        permissions: [
            "projects.create",
            "projects.read",
            "projects.update",
            "projects.delete",
        ],
    },
    events: {
        label: "Events",
        permissions: ["events.read", "events.delete"],
    },
    alerts: {
        label: "Alerts",
        permissions: ["alerts.read", "alerts.manage"],
    },
    "api-keys": {
        label: "API Keys",
        permissions: ["api_keys.read", "api_keys.manage"],
    },
};

export const PERMISSION_GROUP_ORDER: PermissionGroupKey[] = [
    "organization",
    "members",
    "projects",
    "events",
    "alerts",
    "api-keys",
];
