import { describe, it, expect, vi, beforeEach } from "vitest";

const { requestPasswordReset } = vi.hoisted(() => ({ requestPasswordReset: vi.fn() }));

vi.mock("@/core/auth/config", () => ({ auth: { api: { requestPasswordReset } } }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));

import { requestPasswordResetAction } from "./request-password-reset.action";

describe("requestPasswordResetAction", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        requestPasswordReset.mockResolvedValue(undefined);
    });

    describe("validation", () => {
        it.each([["not-an-email"], [""], ["alice@"], ["@example.com"]])(
            "rejects %j without calling the provider",
            async (email) => {
                const result = await requestPasswordResetAction({ email });
                expect(result.error).toBe("Enter a valid email address.");
                expect(requestPasswordReset).not.toHaveBeenCalled();
            },
        );

        it("accepts a well-formed address", async () => {
            const result = await requestPasswordResetAction({ email: "alice@example.com" });
            expect(result).toEqual({});
            expect(requestPasswordReset).toHaveBeenCalledTimes(1);
        });
    });

    describe("no user enumeration", () => {
        it("returns success even when the provider throws", async () => {
            // The whole point of the empty catch: a caller must not be able to
            // tell a registered address from an unregistered one.
            requestPasswordReset.mockRejectedValue(new Error("USER_NOT_FOUND"));
            const result = await requestPasswordResetAction({ email: "nobody@example.com" });
            expect(result).toEqual({});
        });

        it("is indistinguishable between an existing and a missing account", async () => {
            requestPasswordReset.mockResolvedValue(undefined);
            const existing = await requestPasswordResetAction({ email: "alice@example.com" });

            requestPasswordReset.mockRejectedValue(new Error("USER_NOT_FOUND"));
            const missing = await requestPasswordResetAction({ email: "nobody@example.com" });

            expect(existing).toEqual(missing);
        });
    });
});
