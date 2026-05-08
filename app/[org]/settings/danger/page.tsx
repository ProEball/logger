import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/core/auth/server";
import { DeleteOrgForm } from "@/features/organizations/components/DeleteOrgForm/DeleteOrgForm";
import { TransferOwnershipForm } from "@/features/organizations/components/TransferOwnershipForm/TransferOwnershipForm";
import {
    getMembership,
    getOrgBySlug,
    getOrgMembers,
} from "@/features/organizations/services/organizations.service";
import styles from "./page.module.scss";

interface DangerPageProps {
    params: Promise<{ org: string }>;
}

export const metadata = { title: "Danger Zone — Logger" };

export default async function DangerPage({ params }: DangerPageProps) {
    const { org: slug } = await params;

    const user = await getCurrentUser();
    if (!user) redirect("/login");

    const org = await getOrgBySlug(slug);
    if (!org) notFound();

    const membership = await getMembership(user.id, org.id);
    if (!membership) redirect("/login");

    // Both actions on this page are owner-only
    if (!membership.isOwner) notFound();

    const members = await getOrgMembers(org.id);

    return (
        <main className={styles.root}>
            <h1 className={styles.title}>Danger zone</h1>

            <section className={styles.zone}>
                <div className={styles.zoneHeader}>
                    <h2 className={styles.zoneTitle}>Transfer ownership</h2>
                    <p className={styles.zoneDesc}>
                        Transfer owner privileges to another member. You will remain a member.
                    </p>
                </div>
                <TransferOwnershipForm orgSlug={slug} members={members} />
            </section>

            <hr className={styles.divider} />

            <section className={styles.zone}>
                <div className={styles.zoneHeader}>
                    <h2 className={styles.zoneTitle}>Delete organization</h2>
                    <p className={styles.zoneDesc}>
                        Permanently delete this organization and all its data. This cannot be undone.
                    </p>
                </div>
                <DeleteOrgForm orgSlug={slug} orgName={org.name} />
            </section>
        </main>
    );
}
