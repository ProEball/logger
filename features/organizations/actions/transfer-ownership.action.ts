"use server";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser } from "@/core/auth/server";
import { db } from "@/core/db/client";
import { organizationMembers } from "@/core/db/schema";
import { assertOwner } from "@/shared/permissions/guards";
import {
    getMembership,
    getOrgBySlug,
} from "@/features/organizations/services/organizations.service";

const schema = z.object({
    orgSlug: z.string().min(1),
    targetUserId: z.string().min(1),
});

export async function transferOwnershipAction(data: {
    orgSlug: string;
    targetUserId: string;
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
        return { error: "Only the owner can transfer ownership." };
    }

    if (parsed.data.targetUserId === user.id) {
        return { error: "Cannot transfer ownership to yourself." };
    }

    const [target] = await db
        .select({ isOwner: organizationMembers.isOwner })
        .from(organizationMembers)
        .where(
            and(
                eq(organizationMembers.organizationId, org.id),
                eq(organizationMembers.userId, parsed.data.targetUserId),
            ),
        )
        .limit(1);
    if (!target) return { error: "Member not found." };
    if (target.isOwner) return { error: "This member is already an owner." };

    await db.transaction(async (tx) => {
        await tx
            .update(organizationMembers)
            .set({ isOwner: false })
            .where(
                and(
                    eq(organizationMembers.organizationId, org.id),
                    eq(organizationMembers.userId, user.id),
                ),
            );
        await tx
            .update(organizationMembers)
            .set({ isOwner: true })
            .where(
                and(
                    eq(organizationMembers.organizationId, org.id),
                    eq(organizationMembers.userId, parsed.data.targetUserId),
                ),
            );
    });

    revalidatePath(`/${parsed.data.orgSlug}/team`);
    return {};
}
