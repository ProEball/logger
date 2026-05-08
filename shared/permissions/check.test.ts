import { describe, expect, it } from "vitest";
import { hasPermission, type Membership } from "./check";
import { OWNER_ONLY_PERMISSIONS } from "./registry";

const owner: Membership = {
    isOwner: true,
    role: { permissions: [] },
};

const admin: Membership = {
    isOwner: false,
    role: {
        permissions: [
            "org.read",
            "org.update",
            "members.read",
            "members.invite",
            "members.remove",
            "members.role.assign",
            "projects.create",
            "projects.read",
            "projects.update",
            "projects.delete",
            "events.read",
            "events.delete",
            "alerts.read",
            "alerts.manage",
            "api_keys.read",
            "api_keys.manage",
        ],
    },
};

const viewer: Membership = {
    isOwner: false,
    role: {
        permissions: [
            "org.read",
            "members.read",
            "projects.read",
            "events.read",
            "alerts.read",
            "api_keys.read",
        ],
    },
};

const noPerms: Membership = {
    isOwner: false,
    role: { permissions: [] },
};

describe("hasPermission", () => {
    it("owner passes every permission", () => {
        expect(hasPermission(owner, "org.read")).toBe(true);
        expect(hasPermission(owner, "org.delete")).toBe(true);
        expect(hasPermission(owner, "roles.manage")).toBe(true);
        expect(hasPermission(owner, "api_keys.manage")).toBe(true);
    });

    it("member passes permissions present in their role", () => {
        expect(hasPermission(admin, "org.update")).toBe(true);
        expect(hasPermission(viewer, "org.read")).toBe(true);
        expect(hasPermission(viewer, "events.read")).toBe(true);
    });

    it("member is denied permissions absent from their role", () => {
        expect(hasPermission(viewer, "org.update")).toBe(false);
        expect(hasPermission(viewer, "events.delete")).toBe(false);
        expect(hasPermission(noPerms, "org.read")).toBe(false);
    });

    it("non-owner cannot access owner-only permissions unless role explicitly includes them", () => {
        for (const perm of OWNER_ONLY_PERMISSIONS) {
            expect(hasPermission(admin, perm)).toBe(false);
        }
    });

    it("owner always passes owner-only permissions regardless of role permissions", () => {
        for (const perm of OWNER_ONLY_PERMISSIONS) {
            expect(hasPermission(owner, perm)).toBe(true);
        }
    });
});
