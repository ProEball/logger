import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/core/auth/server";
import { OrgSettingsForm } from "@/features/organizations/components/OrgSettingsForm/OrgSettingsForm";
import { getMembership, getOrgBySlug } from "@/features/organizations/services/organizations.service";
import { hasPermission } from "@/shared/permissions/check";
import styles from "./page.module.scss";

interface SettingsPageProps {
    params: Promise<{ org: string }>;
}

export const metadata = { title: "Settings — Logger" };

export default async function OrgSettingsPage({ params }: SettingsPageProps) {
    const { org: slug } = await params;

    const user = await getCurrentUser();
    if (!user) redirect("/login");

    const org = await getOrgBySlug(slug);
    if (!org) notFound();

    const membership = await getMembership(user.id, org.id);
    if (!membership) redirect("/login");

    if (!hasPermission(membership, "org.update")) notFound();

    return (
        <main className={styles.root}>
            <h1 className={styles.title}>Organization settings</h1>

            <section className={styles.section}>
                <h2 className={styles.sectionTitle}>General</h2>
                <OrgSettingsForm
                    orgSlug={slug}
                    orgName={org.name}
                    isOwner={membership.isOwner}
                />
            </section>
        </main>
    );
}
