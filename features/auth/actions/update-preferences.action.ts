"use server";

import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/core/db/client";
import { users } from "@/core/db/schema";
import { getCurrentUser } from "@/core/auth/server";
import { AUTO_REFRESH_VALUES, THEME_VALUES } from "@/shared/types/user-preferences.types";

// Built from the shared constants, never restated. These were literals until
// 2026-08-20, when `5m` reached the type and the UI but not this enum: the
// control flipped optimistically, `safeParse` rejected the write, and the
// setting silently reverted on the next load. `data: unknown` means no type
// error was possible, so only a test or a user could have caught it.
const themeEnum = z.enum(THEME_VALUES);
const autoRefreshEnum = z.enum(AUTO_REFRESH_VALUES);

// Each feature that extends preferences widens this schema (see Decision log CC1).
// Feature 04 added: autoRefresh
const prefsSchema = z
    .object({
        theme: themeEnum.optional(),
        autoRefresh: autoRefreshEnum.optional(),
    })
    .strict();

export async function updatePreferencesAction(
    data: unknown,
): Promise<{ error?: string }> {
    const user = await getCurrentUser();
    if (!user) return { error: "Not authenticated" };

    const parsed = prefsSchema.safeParse(data);
    if (!parsed.success) {
        return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
    }

    // Critical: MERGE pattern — `||` merges jsonb objects without replacing other keys.
    // DO NOT use `.set({ preferences: parsed.data })` — that would wipe unrelated keys.
    const patch = JSON.stringify(parsed.data);
    await db
        .update(users)
        .set({ preferences: sql`preferences || ${patch}::jsonb` })
        .where(eq(users.id, user.id));

    return {};
}
