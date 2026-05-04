import { describe, expect, it, vi } from "vitest";

// mock db so env validation doesn't run in Vitest
vi.mock("@/core/db/client", () => ({ db: {} }));

import { OWNER_ONLY_PERMISSIONS, PERMISSIONS } from "@/shared/permissions/registry";
import type { Permission } from "@/shared/permissions/registry";
import { SYSTEM_ROLE_DEFS } from "./seed-system-roles";

const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

describe("SYSTEM_ROLE_DEFS", () => {
    it("defines exactly three roles", () => {
        expect(SYSTEM_ROLE_DEFS).toHaveLength(3);
    });

    it("all roles have isSystem = true", () => {
        expect(SYSTEM_ROLE_DEFS.every((r) => r.isSystem)).toBe(true);
    });

    it("only Member is the default role", () => {
        const defaults = SYSTEM_ROLE_DEFS.filter((r) => r.isDefault);
        expect(defaults).toHaveLength(1);
        expect(defaults[0].name).toBe("Member");
    });

    describe("Admin", () => {
        const admin = SYSTEM_ROLE_DEFS.find((r) => r.name === "Admin")!;
        const expectedPerms = ALL_PERMISSIONS.filter((p) => !OWNER_ONLY_PERMISSIONS.has(p));

        it("exists", () => expect(admin).toBeDefined());

        it("has all assignable permissions", () => {
            expect(admin.permissions).toHaveLength(expectedPerms.length);
            expect(admin.permissions).toEqual(expect.arrayContaining(expectedPerms));
        });

        it("does not have owner-only permissions", () => {
            for (const perm of OWNER_ONLY_PERMISSIONS) {
                expect(admin.permissions).not.toContain(perm);
            }
        });
    });

    describe("Member", () => {
        const member = SYSTEM_ROLE_DEFS.find((r) => r.name === "Member")!;
        const expectedPerms: Permission[] = [
            "org.read",
            "members.read",
            "projects.read",
            "events.read",
            "alerts.read",
            "api_keys.read",
        ];

        it("exists", () => expect(member).toBeDefined());

        it("has the standard read permission set", () => {
            expect(member.permissions).toHaveLength(expectedPerms.length);
            expect(member.permissions).toEqual(expect.arrayContaining(expectedPerms));
        });
    });

    describe("Viewer", () => {
        const viewer = SYSTEM_ROLE_DEFS.find((r) => r.name === "Viewer")!;
        const expectedPerms = ALL_PERMISSIONS.filter((p) => p.endsWith(".read"));

        it("exists", () => expect(viewer).toBeDefined());

        it("has only read permissions", () => {
            expect(viewer.permissions).toHaveLength(expectedPerms.length);
            expect(viewer.permissions).toEqual(expect.arrayContaining(expectedPerms));
        });

        it("has no write permissions", () => {
            for (const perm of viewer.permissions) {
                expect(perm).toMatch(/\.read$/);
            }
        });
    });
});
