import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryResult, insertValues } = vi.hoisted(() => ({
    queryResult: vi.fn(),
    insertValues: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/core/db/client", () => ({
    db: {
        select: () => ({
            from: () => ({
                where: () => ({ limit: queryResult }),
                innerJoin: () => ({ where: () => ({ limit: queryResult }) }),
            }),
        }),
        insert: () => ({ values: insertValues }),
    },
}));

vi.mock("@/core/env", () => ({ env: { APP_URL: "http://localhost:3000" } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/core/auth/server");
vi.mock("@/features/organizations/services/organizations.service");
vi.mock("@/shared/permissions/guards");

import { inviteMemberAction } from "./invite-member.action";
import { getCurrentUser } from "@/core/auth/server";
import {
    getOrgBySlug,
    getMembership,
} from "@/features/organizations/services/organizations.service";
import { assertPermission } from "@/shared/permissions/guards";

const VALID = {
    orgSlug: "acme",
    email: "bob@test.com",
    roleId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
};

const MOCK_USER = { id: "user-1", email: "alice@test.com", name: "Alice" };
const MOCK_ORG = { id: "org-1", slug: "acme", name: "Acme" };

describe("inviteMemberAction", () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.mocked(getCurrentUser).mockResolvedValue(MOCK_USER as never);
        vi.mocked(getOrgBySlug).mockResolvedValue(MOCK_ORG as never);
        vi.mocked(getMembership).mockResolvedValue({
            isOwner: false,
            role: { permissions: ["members.invite"] },
        } as never);
        vi.mocked(assertPermission).mockReturnValue(undefined);
        insertValues.mockResolvedValue(undefined);
        queryResult
            .mockResolvedValueOnce([{ id: VALID.roleId }])
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([]);
    });

    describe("input validation", () => {
        it("returns error for invalid email", async () => {
            expect(await inviteMemberAction({ ...VALID, email: "not-an-email" })).toEqual({
                error: "Invalid input.",
            });
        });

        it("returns error for empty orgSlug", async () => {
            expect(await inviteMemberAction({ ...VALID, orgSlug: "" })).toEqual({
                error: "Invalid input.",
            });
        });

        it("returns error for non-UUID roleId", async () => {
            expect(await inviteMemberAction({ ...VALID, roleId: "not-a-uuid" })).toEqual({
                error: "Invalid input.",
            });
        });
    });

    it("returns error when not authenticated", async () => {
        vi.mocked(getCurrentUser).mockResolvedValue(null);
        expect(await inviteMemberAction(VALID)).toEqual({ error: "Not authenticated." });
    });

    it("returns error when org not found", async () => {
        vi.mocked(getOrgBySlug).mockResolvedValue(null);
        expect(await inviteMemberAction(VALID)).toEqual({ error: "Organization not found." });
    });

    it("returns error when user lacks invite permission", async () => {
        vi.mocked(assertPermission).mockImplementation(() => {
            throw new Error("Forbidden");
        });
        expect(await inviteMemberAction(VALID)).toEqual({
            error: "You don't have permission to invite members.",
        });
    });

    it("returns error when roleId does not belong to org", async () => {
        queryResult.mockReset().mockResolvedValueOnce([]);
        expect(await inviteMemberAction(VALID)).toEqual({ error: "Invalid role." });
    });

    it("returns error when a pending invitation already exists for the email", async () => {
        queryResult
            .mockReset()
            .mockResolvedValueOnce([{ id: VALID.roleId }])
            .mockResolvedValueOnce([{ id: "existing-invite" }]);
        expect(await inviteMemberAction(VALID)).toEqual({
            error: "A pending invitation for this email already exists.",
        });
    });

    it("returns error when the email is already a member", async () => {
        queryResult
            .mockReset()
            .mockResolvedValueOnce([{ id: VALID.roleId }])
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([{ userId: "user-2" }]);
        expect(await inviteMemberAction(VALID)).toEqual({
            error: "This user is already a member.",
        });
    });

    it("returns an inviteUrl containing a valid UUID token on success", async () => {
        const result = await inviteMemberAction(VALID);
        expect(result).toHaveProperty("inviteUrl");
        const { inviteUrl } = result as { inviteUrl: string };
        expect(inviteUrl).toMatch(
            /^http:\/\/localhost:3000\/invite\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        );
    });
});
