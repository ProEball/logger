"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentUser } from "@/core/auth/server";
import { db } from "@/core/db/client";
import { organizations } from "@/core/db/schema";
import { assertOwner } from "@/shared/permissions/guards";
import {
    getMembership,
    getOrgBySlug,
} from "@/features/organizations/services/organizations.service";

const schema = z.object({
    orgSlug: z.string().min(1),
    // User must type the org name to confirm — validated server-side too.
    confirmName: z.string().min(1),
});

export async function deleteOrgAction(data: {
    orgSlug: string;
    confirmName: string;
}): Promise<{ error?: string }> {
    const parsed = schema.safeParse(data);
    if (!parsed.success) return { error: "Invalid input." };

    const user = await getCurrentUser();
    if (!user) return { error: "Not authenticated." };

    const org = await getOrgBySlug(parsed.data.orgSlug);
    if (!org) return { error: "Organization not found." };

    const membership = await getMembership(user.id, org.id);
    try {
        assertOwner(membership);
    } catch {
        return { error: "Only the owner can delete the organization." };
    }

    if (parsed.data.confirmName !== org.name) {
        return { error: "Organization name does not match. Please type it exactly." };
    }

    await db.delete(organizations).where(eq(organizations.id, org.id));

    // All org data is deleted via CASCADE. Redirect to root — proxy handles unauthenticated state.
    redirect("/");
}
