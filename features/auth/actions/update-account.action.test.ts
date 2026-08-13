import { describe, it, expect, vi, beforeEach } from "vitest";

const { updateUser, revalidatePath } = vi.hoisted(() => ({
    updateUser: vi.fn(),
    revalidatePath: vi.fn(),
}));

vi.mock("@/core/auth/config", () => ({ auth: { api: { updateUser } } }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("next/cache", () => ({ revalidatePath }));

import { updateAccountAction } from "./update-account.action";

describe("updateAccountAction", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        updateUser.mockResolvedValue(undefined);
    });

    describe("name validation", () => {
        it("rejects an empty name", async () => {
            const result = await updateAccountAction({ name: "" });
            expect(result.error).toBe("Name is required");
            expect(updateUser).not.toHaveBeenCalled();
        });

        it("accepts a name of exactly 100 characters", async () => {
            const result = await updateAccountAction({ name: "a".repeat(100) });
            expect(result.error).toBeUndefined();
        });

        it("rejects 101 characters", async () => {
            const result = await updateAccountAction({ name: "a".repeat(101) });
            expect(result.error).toBe("Name must be 100 characters or fewer");
            expect(updateUser).not.toHaveBeenCalled();
        });
    });

    describe("delivery", () => {
        it("forwards the name and revalidates the account page", async () => {
            const result = await updateAccountAction({ name: "Alice" });
            expect(updateUser).toHaveBeenCalledWith(expect.objectContaining({ body: { name: "Alice" } }));
            expect(revalidatePath).toHaveBeenCalledWith("/account");
            expect(result).toEqual({});
        });

        it("returns a generic error and does not revalidate on failure", async () => {
            updateUser.mockRejectedValue(new Error("DB down"));
            const result = await updateAccountAction({ name: "Alice" });
            expect(result.error).toBe("Failed to update profile.");
            expect(revalidatePath).not.toHaveBeenCalled();
        });
    });
});
