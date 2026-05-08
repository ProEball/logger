import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/core/auth/server";
import { RolesList } from "@/features/roles/components/RolesList/RolesList";
import { getOrgRoles } from "@/features/roles/services/roles.service";
import { getMembership, getOrgBySlug } from "@/features/organizations/services/organizations.service";
import styles from "./page.module.scss";

interface RolesPageProps {
    params: Promise<{ org: string }>;
}

export const metadata = { title: "Roles — Logger" };

export default async function RolesPage({ params }: RolesPageProps) {
    const { org: slug } = await params;

    const user = await getCurrentUser();
    if (!user) redirect("/login");

    const org = await getOrgBySlug(slug);
    if (!org) notFound();

    const membership = await getMembership(user.id, org.id);
    if (!membership) redirect("/login");

    // roles.manage is owner-only — non-owners get 404
    if (!membership.isOwner) notFound();

    const roles = await getOrgRoles(org.id);

    return (
        <main className={styles.root}>
            <div className={styles.header}>
                <h1 className={styles.title}>Roles</h1>
                <Link href={`/${slug}/settings/roles/new`} className={styles.newBtn}>
                    New role
                </Link>
            </div>

            <RolesList roles={roles} orgSlug={slug} />
        </main>
    );
}
