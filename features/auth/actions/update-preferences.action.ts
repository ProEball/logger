"use server";

import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/core/db/client";
import { users } from "@/core/db/schema";
import { getCurrentUser } from "@/core/auth/server";

const themeEnum = z.enum(["dark", "light", "system"]);
const autoRefreshEnum = z.enum(["off", "10s", "30s", "60s"]);

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
