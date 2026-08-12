import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/core/auth/server";
import { RoleEditor } from "@/features/roles/components/RoleEditor/RoleEditor";
import { getMembership, getOrgBySlug } from "@/features/organizations/services/organizations.service";
import styles from "./page.module.scss";

interface NewRolePageProps {
    params: Promise<{ org: string }>;
}

export const metadata = { title: "New Role — Logger" };

export default async function NewRolePage({ params }: NewRolePageProps) {
    const { org: slug } = await params;

    const user = await getCurrentUser();
    if (!user) redirect("/login");

    const org = await getOrgBySlug(slug);
    if (!org) notFound();

    const membership = await getMembership(user.id, org.id);
    if (!membership) redirect("/login");

    if (!membership.isOwner) notFound();

    return (
        <main className={styles.root}>
            <RoleEditor orgSlug={slug} />
        </main>
    );
}
