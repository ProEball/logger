"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { hashPassword } from "@better-auth/utils/password";
import { db } from "@/core/db/client";
import { accounts, organizations, users } from "@/core/db/schema";
import { organizationMembers } from "@/core/db/schema";
import { auth } from "@/core/auth/config";
import { seedSystemRoles } from "@/features/roles/utils/seed-system-roles";

export type SetupFormData = {
    orgName: string;
    name: string;
    email: string;
    password: string;
};

export type SetupResult = { error?: string };

// Fixed key for pg_advisory_xact_lock — prevents two simultaneous /setup submits
// from both passing the COUNT check and creating duplicate owners.
const SETUP_LOCK_KEY = 7_438_291;

class SetupAlreadyDoneError extends Error {}

function slugify(name: string): string {
    return name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

export async function setupAction(data: SetupFormData): Promise<SetupResult> {
    let orgSlug: string;

    try {
        orgSlug = await db.transaction(async (tx) => {
            await tx.execute(sql`SELECT pg_advisory_xact_lock(${SETUP_LOCK_KEY})`);

            const [{ count }] = await tx
                .select({ count: sql<number>`COUNT(*)::int` })
                .from(users);

            if (count > 0) throw new SetupAlreadyDoneError();

            const userId = crypto.randomUUID();
            const hashedPassword = await hashPassword(data.password);

            await tx.insert(users).values({
                id: userId,
                name: data.name,
                email: data.email,
                emailVerified: false,
            });

            await tx.insert(accounts).values({
                id: crypto.randomUUID(),
                userId,
                accountId: data.email,
                providerId: "credential",
                password: hashedPassword,
            });

            const slug = slugify(data.orgName);
            const [org] = await tx
                .insert(organizations)
                .values({ name: data.orgName, slug })
                .returning({ id: organizations.id });

            const { adminRoleId } = await seedSystemRoles(org.id, tx);

            await tx.insert(organizationMembers).values({
                organizationId: org.id,
                userId,
                roleId: adminRoleId,
                isOwner: true,
            });

            return slug;
        });
    } catch (err) {
        if (err instanceof SetupAlreadyDoneError) {
            return { error: "Setup is already complete. Please sign in." };
        }
        console.error("[setup] transaction failed:", err);
        return { error: "Something went wrong. Please try again." };
    }

    await auth.api.signInEmail({
        body: { email: data.email, password: data.password },
        headers: await headers(),
    });

    redirect(`/${orgSlug}`);
}
