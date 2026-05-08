export const PERMISSIONS = {
    // Organization
    "org.read": "View organization",
    "org.update": "Edit organization settings",
    "org.delete": "Delete organization",
    // Members & Roles
    "members.read": "View members",
    "members.invite": "Invite members",
    "members.remove": "Remove members",
    "members.role.assign": "Change member roles",
    "roles.manage": "Create and edit custom roles",
    // Projects
    "projects.create": "Create projects",
    "projects.read": "View projects",
    "projects.update": "Edit projects",
    "projects.delete": "Delete projects",
    // Events
    "events.read": "Read events",
    "events.delete": "Delete events",
    // Alerts
    "alerts.read": "View alerts",
    "alerts.manage": "Create/edit/delete alerts",
    // API keys
    "api_keys.read": "View API keys",
    "api_keys.manage": "Create/revoke API keys",
} as const;

export type Permission = keyof typeof PERMISSIONS;

// These permissions belong to the owner only — never assignable to any role.
// The permission matrix UI must hide them; guards must use assertOwner instead.
export const OWNER_ONLY_PERMISSIONS = new Set<Permission>([
    "org.delete",
    "roles.manage",
]);
