"use server";

import { and, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser } from "@/core/auth/server";
import { db } from "@/core/db/client";
import { organizations } from "@/core/db/schema";
import { assertOwner, assertPermission } from "@/shared/permissions/guards";
import {
    getMembership,
    getOrgBySlug,
} from "@/features/organizations/services/organizations.service";

const schema = z.object({
    orgSlug: z.string().min(1),
    name: z.string().min(1, "Name is required").max(100, "Name must be 100 characters or fewer"),
    newSlug: z
        .string()
        .min(2, "Slug must be at least 2 characters")
        .max(60, "Slug must be 60 characters or fewer")
        .regex(/^[a-z0-9-]+$/, "Slug may only contain lowercase letters, numbers, and hyphens"),
});

export async function updateOrgAction(data: {
    orgSlug: string;
    name: string;
    newSlug: string;
}): Promise<{ error?: string; newSlug?: string }> {
    const parsed = schema.safeParse(data);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

    const user = await getCurrentUser();
    if (!user) return { error: "Not authenticated." };

    const org = await getOrgBySlug(parsed.data.orgSlug);
    if (!org) return { error: "Organization not found." };

    const membership = await getMembership(user.id, org.id);
    try {
        assertPermission(membership, "org.update");
    } catch {
        return { error: "You don't have permission to edit organization settings." };
    }

    const slugChanged = parsed.data.newSlug !== parsed.data.orgSlug;

    // Slug change is owner-only — it breaks all existing URLs.
    if (slugChanged) {
        try {
            assertOwner(membership);
        } catch {
            return { error: "Only the owner can change the organization slug." };
        }

        // Check uniqueness
        const [conflict] = await db
            .select({ id: organizations.id })
            .from(organizations)
            .where(
                and(
                    eq(organizations.slug, parsed.data.newSlug),
                    ne(organizations.id, org.id),
                ),
            )
            .limit(1);
        if (conflict) return { error: "This slug is already taken." };
    }

    try {
        await db
            .update(organizations)
            .set({
                name: parsed.data.name,
                slug: parsed.data.newSlug,
                updatedAt: new Date(),
            })
            .where(eq(organizations.id, org.id));

        revalidatePath(`/${parsed.data.newSlug}/settings`);
        return slugChanged ? { newSlug: parsed.data.newSlug } : {};
    } catch {
        return { error: "Failed to update organization." };
    }
}
