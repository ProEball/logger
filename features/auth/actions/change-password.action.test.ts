import { describe, it, expect, vi, beforeEach } from "vitest";

const { changePassword, revokeOtherSessions } = vi.hoisted(() => ({
    changePassword: vi.fn(),
    revokeOtherSessions: vi.fn(),
}));

vi.mock("@/core/auth/config", () => ({
    auth: { api: { changePassword, revokeOtherSessions } },
}));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));

import { changePasswordAction } from "./change-password.action";

const VALID = {
    currentPassword: "old-password",
    newPassword: "new-password-123",
    confirmPassword: "new-password-123",
};

describe("changePasswordAction", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        changePassword.mockResolvedValue(undefined);
        revokeOtherSessions.mockResolvedValue(undefined);
    });

    describe("validation", () => {
        it("rejects a new password shorter than 8 characters", async () => {
            const result = await changePasswordAction({
                ...VALID,
                newPassword: "short",
                confirmPassword: "short",
            });
            expect(result.error).toContain("at least 8 characters");
            expect(changePassword).not.toHaveBeenCalled();
        });

        it("accepts a new password of exactly 8 characters", async () => {
            const result = await changePasswordAction({
                ...VALID,
                newPassword: "12345678",
                confirmPassword: "12345678",
            });
            expect(result.error).toBeUndefined();
        });

        it("rejects a mismatched confirmation", async () => {
            const result = await changePasswordAction({
                ...VALID,
                confirmPassword: "something-else",
            });
            expect(result.error).toBe("Passwords do not match");
            expect(changePassword).not.toHaveBeenCalled();
        });

        it("rejects an empty current password", async () => {
            const result = await changePasswordAction({ ...VALID, currentPassword: "" });
            expect(result.error).toContain("Current password is required");
            expect(changePassword).not.toHaveBeenCalled();
        });
    });

    describe("on success", () => {
        it("forwards only the current and new password to better-auth", async () => {
            await changePasswordAction(VALID);
            expect(changePassword).toHaveBeenCalledWith(
                expect.objectContaining({
                    body: { currentPassword: "old-password", newPassword: "new-password-123" },
                }),
            );
        });

        it("revokes other sessions", async () => {
            const result = await changePasswordAction(VALID);
            expect(revokeOtherSessions).toHaveBeenCalledTimes(1);
            expect(result).toEqual({});
        });

        it("does not pass changePassword's own revokeOtherSessions body flag", async () => {
            // Regression guard for cf57619: the flag deletes *every* session,
            // including the caller's, and the replacement cookie did not land
            // reliably from a Server Action. Revocation must stay a separate call.
            await changePasswordAction(VALID);
            const body = changePassword.mock.calls[0]![0].body;
            expect(body).not.toHaveProperty("revokeOtherSessions");
        });

        it("revokes using the same headers it authenticated with", async () => {
            await changePasswordAction(VALID);
            const changeHeaders = changePassword.mock.calls[0]![0].headers;
            const revokeHeaders = revokeOtherSessions.mock.calls[0]![0].headers;
            expect(revokeHeaders).toBe(changeHeaders);
        });
    });

    describe("on failure", () => {
        it("returns a generic message when the current password is wrong", async () => {
            changePassword.mockRejectedValue(new Error("INVALID_PASSWORD"));
            const result = await changePasswordAction(VALID);
            expect(result.error).toBe("Current password is incorrect.");
        });

        it("does not revoke sessions when the change failed", async () => {
            changePassword.mockRejectedValue(new Error("INVALID_PASSWORD"));
            await changePasswordAction(VALID);
            expect(revokeOtherSessions).not.toHaveBeenCalled();
        });

        it("does not leak the underlying auth error", async () => {
            changePassword.mockRejectedValue(new Error("user 4f2a not found in accounts"));
            const result = await changePasswordAction(VALID);
            expect(result.error).not.toContain("4f2a");
            expect(result.error).not.toContain("accounts");
        });
    });
});
