import { describe, it, expect, vi, beforeEach } from "vitest";

/** The column patch handed to Drizzle's `.set()`. */
type Patch = { preferences: unknown };

const { setSpy, whereSpy, updateSpy, getCurrentUser } = vi.hoisted(() => {
    const whereSpy = vi.fn().mockResolvedValue(undefined);
    const setSpy = vi.fn((_patch: { preferences: unknown }) => ({ where: whereSpy }));
    return {
        whereSpy,
        setSpy,
        updateSpy: vi.fn(() => ({ set: setSpy })),
        getCurrentUser: vi.fn(),
    };
});

vi.mock("@/core/db/client", () => ({ db: { update: updateSpy } }));
vi.mock("@/core/auth/server", () => ({ getCurrentUser }));

import { updatePreferencesAction } from "./update-preferences.action";
import { AUTO_REFRESH_VALUES, THEME_VALUES } from "@/shared/types/user-preferences.types";

/** Flattens a Drizzle SQL fragment to a comparable string. */
function sqlToText(fragment: unknown): string {
    const chunks = (fragment as { queryChunks?: unknown[] })?.queryChunks;
    if (!Array.isArray(chunks)) return String(fragment);
    return chunks
        .map((c) => (typeof c === "object" && c !== null && "value" in c ? String((c as { value: unknown }).value) : String(c)))
        .join(" ");
}

describe("updatePreferencesAction", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getCurrentUser.mockResolvedValue({ id: "user-1" });
    });

    describe("authentication", () => {
        it("refuses an unauthenticated caller", async () => {
            getCurrentUser.mockResolvedValue(null);
            const result = await updatePreferencesAction({ theme: "dark" });
            expect(result.error).toBe("Not authenticated");
            expect(updateSpy).not.toHaveBeenCalled();
        });
    });

    describe("validation", () => {
        it.each([
            ["theme", { theme: "dark" }],
            ["autoRefresh", { autoRefresh: "30s" }],
            ["both together", { theme: "system", autoRefresh: "off" }],
            ["empty patch", {}],
        ])("accepts %s", async (_label, input) => {
            const result = await updatePreferencesAction(input);
            expect(result.error).toBeUndefined();
        });

        it.each([
            ["an invalid theme", { theme: "neon" }],
            ["an invalid autoRefresh", { autoRefresh: "5s" }],
            ["a non-object", "dark"],
        ])("rejects %s", async (_label, input) => {
            const result = await updatePreferencesAction(input);
            expect(result.error).toBeDefined();
            expect(updateSpy).not.toHaveBeenCalled();
        });

        it("rejects unknown keys — the schema is strict", async () => {
            // Without .strict() an attacker-supplied key would be merged straight
            // into the users.preferences jsonb column.
            const result = await updatePreferencesAction({ theme: "dark", isAdmin: true });
            expect(result.error).toBeDefined();
            expect(updateSpy).not.toHaveBeenCalled();
        });
    });

    describe("the write itself", () => {
        it("merges into the jsonb column instead of replacing it", async () => {
            // PLAN.md CC1 / decision log: `preferences || patch::jsonb`. A plain
            // .set({ preferences: data }) silently wipes every sibling key that
            // another feature owns.
            await updatePreferencesAction({ theme: "light" });

            const patch: Patch = setSpy.mock.calls[0]![0];
            const text = sqlToText(patch.preferences);

            expect(text).toContain("||");
            expect(text).toContain("jsonb");
            expect(patch.preferences).not.toEqual({ theme: "light" });
        });

        it("sends only the validated keys in the patch", async () => {
            await updatePreferencesAction({ theme: "light" });
            const patch: Patch = setSpy.mock.calls[0]![0];
            const text = sqlToText(patch.preferences);
            expect(text).toContain('"theme":"light"');
        });

        it("scopes the update to the current user", async () => {
            getCurrentUser.mockResolvedValue({ id: "user-42" });
            await updatePreferencesAction({ theme: "dark" });
            expect(whereSpy).toHaveBeenCalledTimes(1);
            expect(updateSpy).toHaveBeenCalledTimes(1);
        });
    });

    /**
     * The schema is built from AUTO_REFRESH_VALUES / THEME_VALUES rather than
     * restating them. Before 2026-08-20 it restated them, and the copies drifted:
     * `5m` reached the type and the control but not the enum, so the write was
     * rejected while Redux had already flipped. The setting looked applied and
     * reverted on the next load.
     *
     * These assert the schema tracks the shared list, which is the property that
     * broke — not that the list has any particular contents today.
     */
    describe("accepts exactly the values the shared type allows", () => {
        it.each(AUTO_REFRESH_VALUES)("accepts autoRefresh %s", async (value) => {
            const result = await updatePreferencesAction({ autoRefresh: value });

            expect(result.error).toBeUndefined();
            expect(updateSpy).toHaveBeenCalled();
        });

        it.each(THEME_VALUES)("accepts theme %s", async (value) => {
            const result = await updatePreferencesAction({ theme: value });

            expect(result.error).toBeUndefined();
        });

        /**
         * `10s` is migrated on *read* by `parseAutoRefresh`, but nothing emits it
         * any more, so a client sending it is a client sending a stale value.
         */
        it("rejects the retired 10s interval", async () => {
            const result = await updatePreferencesAction({ autoRefresh: "10s" });

            expect(result.error).toBeDefined();
            expect(updateSpy).not.toHaveBeenCalled();
        });

        it("rejects a value that is in neither list", async () => {
            const result = await updatePreferencesAction({ autoRefresh: "1h" });

            expect(result.error).toBeDefined();
            expect(updateSpy).not.toHaveBeenCalled();
        });
    });
});
