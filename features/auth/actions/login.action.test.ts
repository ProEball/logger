import { describe, it, expect, vi, beforeEach } from "vitest";

const { signInEmail, redirect } = vi.hoisted(() => ({
    signInEmail: vi.fn(),
    redirect: vi.fn(),
}));

vi.mock("@/core/auth/config", () => ({ auth: { api: { signInEmail } } }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("next/navigation", () => ({ redirect }));

import { loginAction } from "./login.action";

const CREDS = { email: "alice@example.com", password: "correct-horse" };

describe("loginAction", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        signInEmail.mockResolvedValue(undefined);
    });

    it("forwards the credentials to better-auth", async () => {
        await loginAction(CREDS);
        expect(signInEmail).toHaveBeenCalledWith(
            expect.objectContaining({ body: { email: CREDS.email, password: CREDS.password } }),
        );
    });

    it("redirects to the root on success", async () => {
        await loginAction(CREDS);
        expect(redirect).toHaveBeenCalledWith("/");
    });

    it("returns a generic error when sign-in fails", async () => {
        signInEmail.mockRejectedValue(new Error("INVALID_PASSWORD"));
        const result = await loginAction(CREDS);
        expect(result).toEqual({ error: "Invalid email or password." });
    });

    it("does not redirect when sign-in fails", async () => {
        signInEmail.mockRejectedValue(new Error("INVALID_PASSWORD"));
        await loginAction(CREDS);
        expect(redirect).not.toHaveBeenCalled();
    });

    it("gives the same message for an unknown user and a wrong password", async () => {
        // No user-enumeration signal: the two failures must be indistinguishable.
        signInEmail.mockRejectedValue(new Error("USER_NOT_FOUND"));
        const unknownUser = await loginAction({ ...CREDS, email: "nobody@example.com" });

        signInEmail.mockRejectedValue(new Error("INVALID_PASSWORD"));
        const wrongPassword = await loginAction(CREDS);

        expect(unknownUser).toEqual(wrongPassword);
    });

    it("does not leak the underlying auth error", async () => {
        signInEmail.mockRejectedValue(new Error("no account row for alice@example.com"));
        const result = await loginAction(CREDS);
        expect(result?.error).not.toContain("alice@example.com");
    });
});
