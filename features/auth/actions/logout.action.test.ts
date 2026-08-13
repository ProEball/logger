import { describe, it, expect, vi, beforeEach } from "vitest";

const { signOut, redirect } = vi.hoisted(() => ({ signOut: vi.fn(), redirect: vi.fn() }));

vi.mock("@/core/auth/config", () => ({ auth: { api: { signOut } } }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("next/navigation", () => ({ redirect }));

import { logoutAction } from "./logout.action";

describe("logoutAction", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        signOut.mockResolvedValue(undefined);
    });

    it("signs out and redirects to /login", async () => {
        await logoutAction();
        expect(signOut).toHaveBeenCalledTimes(1);
        expect(redirect).toHaveBeenCalledWith("/login");
    });

    it("does not redirect if sign-out throws", async () => {
        // A failed sign-out must not drop the user on /login still holding a
        // live session cookie.
        signOut.mockRejectedValue(new Error("network"));
        await expect(logoutAction()).rejects.toThrow();
        expect(redirect).not.toHaveBeenCalled();
    });
});
