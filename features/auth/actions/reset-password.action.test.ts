import { describe, it, expect, vi, beforeEach } from "vitest";

const { resetPassword, redirect } = vi.hoisted(() => ({
    resetPassword: vi.fn(),
    redirect: vi.fn(),
}));

vi.mock("@/core/auth/config", () => ({ auth: { api: { resetPassword } } }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("next/navigation", () => ({ redirect }));

import { resetPasswordAction } from "./reset-password.action";

const VALID = { token: "tok-123", password: "new-password-1", confirmPassword: "new-password-1" };

describe("resetPasswordAction", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetPassword.mockResolvedValue(undefined);
    });

    describe("validation", () => {
        it("rejects a password shorter than 8 characters", async () => {
            const result = await resetPasswordAction({
                ...VALID,
                password: "short12",
                confirmPassword: "short12",
            });
            expect(result.error).toContain("at least 8 characters");
            expect(resetPassword).not.toHaveBeenCalled();
        });

        it("accepts exactly 8 characters", async () => {
            // The success path ends in redirect(), so the action returns nothing —
            // reaching the provider call is what proves validation passed.
            await resetPasswordAction({
                ...VALID,
                password: "12345678",
                confirmPassword: "12345678",
            });
            expect(resetPassword).toHaveBeenCalledTimes(1);
        });

        it("rejects a mismatched confirmation", async () => {
            const result = await resetPasswordAction({ ...VALID, confirmPassword: "different-1" });
            expect(result.error).toBe("Passwords do not match");
            expect(resetPassword).not.toHaveBeenCalled();
        });

        it("rejects an empty token", async () => {
            const result = await resetPasswordAction({ ...VALID, token: "" });
            expect(result.error).toBeDefined();
            expect(resetPassword).not.toHaveBeenCalled();
        });
    });

    describe("delivery", () => {
        it("sends the token and the new password", async () => {
            await resetPasswordAction(VALID);
            expect(resetPassword).toHaveBeenCalledWith(
                expect.objectContaining({ body: { token: "tok-123", newPassword: "new-password-1" } }),
            );
        });

        it("redirects to /login on success", async () => {
            await resetPasswordAction(VALID);
            expect(redirect).toHaveBeenCalledWith("/login");
        });

        it("returns one message for both an invalid and an expired token", async () => {
            resetPassword.mockRejectedValue(new Error("TOKEN_EXPIRED"));
            const expired = await resetPasswordAction(VALID);

            resetPassword.mockRejectedValue(new Error("TOKEN_NOT_FOUND"));
            const invalid = await resetPasswordAction(VALID);

            expect(expired).toEqual(invalid);
            expect(expired.error).toBe("This reset link is invalid or has expired.");
        });

        it("does not redirect when the reset fails", async () => {
            resetPassword.mockRejectedValue(new Error("TOKEN_EXPIRED"));
            await resetPasswordAction(VALID);
            expect(redirect).not.toHaveBeenCalled();
        });
    });
});
