import { describe, it, expect, vi, beforeEach } from "vitest";

const { revokeSession, revalidatePath } = vi.hoisted(() => ({
    revokeSession: vi.fn(),
    revalidatePath: vi.fn(),
}));

vi.mock("@/core/auth/config", () => ({ auth: { api: { revokeSession } } }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("next/cache", () => ({ revalidatePath }));

import { revokeSessionAction } from "./revoke-session.action";

describe("revokeSessionAction", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        revokeSession.mockResolvedValue(undefined);
    });

    it("rejects an empty token without calling the provider", async () => {
        const result = await revokeSessionAction({ token: "" });
        expect(result.error).toBe("Invalid input.");
        expect(revokeSession).not.toHaveBeenCalled();
    });

    it("forwards the token", async () => {
        await revokeSessionAction({ token: "sess-1" });
        expect(revokeSession).toHaveBeenCalledWith(
            expect.objectContaining({ body: { token: "sess-1" } }),
        );
    });

    it("revalidates the sessions page on success", async () => {
        const result = await revokeSessionAction({ token: "sess-1" });
        expect(revalidatePath).toHaveBeenCalledWith("/account/sessions");
        expect(result).toEqual({});
    });

    it("returns a generic error and does not revalidate when revocation fails", async () => {
        revokeSession.mockRejectedValue(new Error("SESSION_NOT_FOUND"));
        const result = await revokeSessionAction({ token: "sess-1" });
        expect(result.error).toBe("Failed to revoke session.");
        expect(revalidatePath).not.toHaveBeenCalled();
    });
});
