import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/core/db/client";
import { invitations, organizationMembers, organizations, roles, users } from "@/core/db/schema";

export async function getOrgBySlug(slug: string): Promise<typeof organizations.$inferSelect | null> {
    const [org] = await db
        .select()
        .from(organizations)
        .where(eq(organizations.slug, slug))
        .limit(1);
    return org ?? null;
}

export async function getFirstOrgForUser(userId: string): Promise<typeof organizations.$inferSelect | null> {
    const [row] = await db
        .select({
            id: organizations.id,
            name: organizations.name,
            slug: organizations.slug,
            plan: organizations.plan,
            limits: organizations.limits,
            allowSignup: organizations.allowSignup,
            createdAt: organizations.createdAt,
            updatedAt: organizations.updatedAt,
        })
        .from(organizationMembers)
        .innerJoin(organizations, eq(organizationMembers.organizationId, organizations.id))
        .where(eq(organizationMembers.userId, userId))
        .orderBy(organizationMembers.joinedAt)
        .limit(1);
    return row ?? null;
}

export async function getMembership(userId: string, organizationId: string) {
    const [row] = await db
        .select({
            isOwner: organizationMembers.isOwner,
            roleId: organizationMembers.roleId,
            role: { permissions: roles.permissions },
        })
        .from(organizationMembers)
        .innerJoin(roles, eq(organizationMembers.roleId, roles.id))
        .where(
            and(
                eq(organizationMembers.userId, userId),
                eq(organizationMembers.organizationId, organizationId),
            ),
        )
        .limit(1);
    return row ?? null;
}

export type OrgMember = {
    userId: string;
    name: string;
    email: string;
    roleId: string;
    roleName: string;
    isOwner: boolean;
    joinedAt: Date;
};

export async function getOrgMembers(organizationId: string): Promise<OrgMember[]> {
    return db
        .select({
            userId: organizationMembers.userId,
            name: users.name,
            email: users.email,
            roleId: organizationMembers.roleId,
            roleName: roles.name,
            isOwner: organizationMembers.isOwner,
            joinedAt: organizationMembers.joinedAt,
        })
        .from(organizationMembers)
        .innerJoin(users, eq(organizationMembers.userId, users.id))
        .innerJoin(roles, eq(organizationMembers.roleId, roles.id))
        .where(eq(organizationMembers.organizationId, organizationId));
}

export type PendingInvitation = {
    id: string;
    email: string;
    roleId: string;
    roleName: string;
    expiresAt: Date;
    createdAt: Date;
};

export async function getPendingInvitations(organizationId: string): Promise<PendingInvitation[]> {
    return db
        .select({
            id: invitations.id,
            email: invitations.email,
            roleId: invitations.roleId,
            roleName: roles.name,
            expiresAt: invitations.expiresAt,
            createdAt: invitations.createdAt,
        })
        .from(invitations)
        .innerJoin(roles, eq(invitations.roleId, roles.id))
        .where(
            and(
                eq(invitations.organizationId, organizationId),
                isNull(invitations.acceptedAt),
            ),
        );
}
