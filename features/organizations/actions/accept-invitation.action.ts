"use server";
import { and, eq, isNull } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { hashPassword } from "@better-auth/utils/password";
import { getCurrentUser } from "@/core/auth/server";
import { auth } from "@/core/auth/config";
import { db } from "@/core/db/client";
import {
    accounts,
    invitations,
    organizationMembers,
    organizations,
    users,
} from "@/core/db/schema";

type Result = { error?: string };

async function findPendingInvitation(token: string) {
    const [invite] = await db
        .select()
        .from(invitations)
        .where(and(eq(invitations.token, token), isNull(invitations.acceptedAt)))
        .limit(1);
    return invite ?? null;
}

async function getOrgForInvite(organizationId: string) {
    const [org] = await db
        .select({ id: organizations.id, slug: organizations.slug })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .limit(1);
    return org ?? null;
}

// ── Existing logged-in user ────────────────────────────────────────────────
export async function acceptInvitationAction(token: string): Promise<Result> {
    const user = await getCurrentUser();
    if (!user) return { error: "Not authenticated." };

    const invite = await findPendingInvitation(token);
    if (!invite) return { error: "Invitation not found or already used." };
    if (invite.expiresAt < new Date()) return { error: "This invitation has expired." };
    if (invite.email.toLowerCase() !== user.email.toLowerCase()) {
        return { error: "This invitation is for a different email address." };
    }

    const org = await getOrgForInvite(invite.organizationId);
    if (!org) return { error: "Organization no longer exists." };

    await db.transaction(async (tx) => {
        await tx.insert(organizationMembers).values({
            organizationId: invite.organizationId,
            userId: user.id,
            roleId: invite.roleId,
            isOwner: false,
        });
        await tx
            .update(invitations)
            .set({ acceptedAt: new Date() })
            .where(eq(invitations.id, invite.id));
    });

    redirect(`/${org.slug}`);
}

// ── New user registration ──────────────────────────────────────────────────
const registerSchema = z.object({
    token: z.string().min(1),
    name: z.string().min(1, "Name is required"),
    password: z.string().min(8, "Password must be at least 8 characters"),
});

export async function registerAndAcceptAction(data: {
    token: string;
    name: string;
    password: string;
}): Promise<Result> {
    const parsed = registerSchema.safeParse(data);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

    const invite = await findPendingInvitation(parsed.data.token);
    if (!invite) return { error: "Invitation not found or already used." };
    if (invite.expiresAt < new Date()) return { error: "This invitation has expired." };

    const org = await getOrgForInvite(invite.organizationId);
    if (!org) return { error: "Organization no longer exists." };

    const userId = crypto.randomUUID();
    const hashedPwd = await hashPassword(parsed.data.password);

    await db.transaction(async (tx) => {
        await tx.insert(users).values({
            id: userId,
            name: parsed.data.name,
            email: invite.email,
            emailVerified: false,
        });
        await tx.insert(accounts).values({
            id: crypto.randomUUID(),
            userId,
            accountId: invite.email,
            providerId: "credential",
            password: hashedPwd,
        });
        await tx.insert(organizationMembers).values({
            organizationId: invite.organizationId,
            userId,
            roleId: invite.roleId,
            isOwner: false,
        });
        await tx
            .update(invitations)
            .set({ acceptedAt: new Date() })
            .where(eq(invitations.id, invite.id));
    });

    await auth.api.signInEmail({
        body: { email: invite.email, password: parsed.data.password },
        headers: await headers(),
    });

    redirect(`/${org.slug}`);
}
