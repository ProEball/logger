import { eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/core/auth/server";
import { db } from "@/core/db/client";
import { roles } from "@/core/db/schema";
import { MembersList } from "@/features/organizations/components/MembersList/MembersList";
import { InvitationsList } from "@/features/organizations/components/InvitationsList/InvitationsList";
import { InviteSection } from "@/features/organizations/components/InviteSection/InviteSection";
import {
    getOrgBySlug,
    getMembership,
    getOrgMembers,
    getPendingInvitations,
} from "@/features/organizations/services/organizations.service";
import { hasPermission } from "@/shared/permissions/check";
import styles from "./page.module.scss";

interface TeamPageProps {
    params: Promise<{ org: string }>;
}

export const metadata = { title: "Team — Logger" };

export default async function TeamPage({ params }: TeamPageProps) {
    const { org: slug } = await params;

    const user = await getCurrentUser();
    if (!user) redirect("/login");

    const org = await getOrgBySlug(slug);
    if (!org) notFound();

    const membership = await getMembership(user.id, org.id);
    if (!membership) redirect("/login");

    if (!hasPermission(membership, "members.read")) notFound();

    const [members, pendingInvites, orgRoles] = await Promise.all([
        getOrgMembers(org.id),
        getPendingInvitations(org.id),
        db
            .select({ id: roles.id, name: roles.name })
            .from(roles)
            .where(eq(roles.organizationId, org.id)),
    ]);

    const canInvite = hasPermission(membership, "members.invite");
    const canChangeRole = hasPermission(membership, "members.role.assign");
    const canRemove = hasPermission(membership, "members.remove");

    const subtitle = [
        `${members.length} member${members.length !== 1 ? 's' : ''}`,
        pendingInvites.length > 0 ? `${pendingInvites.length} pending` : null,
    ].filter(Boolean).join(' · ');

    return (
        <main className={styles.root}>
            <div className={styles.header}>
                <h1 className={styles.title}>Team</h1>
                <span className={styles.subtitle}>{subtitle}</span>
                <div className={styles.spacer} />
                {canInvite ? <InviteSection orgSlug={slug} roles={orgRoles} /> : null}
            </div>

            <div className={styles.sections}>
                <MembersList
                    members={members}
                    roles={orgRoles}
                    orgSlug={slug}
                    currentUserId={user.id}
                    actorCanChangeRole={canChangeRole}
                    actorCanRemove={canRemove}
                    isActorOwner={membership.isOwner}
                />
                <InvitationsList invitations={pendingInvites} orgSlug={slug} />
            </div>
        </main>
    );
}
