import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/core/auth/server";
import { RoleEditor } from "@/features/roles/components/RoleEditor/RoleEditor";
import { getRoleById } from "@/features/roles/services/roles.service";
import { getMembership, getOrgBySlug } from "@/features/organizations/services/organizations.service";
import styles from "./page.module.scss";

interface EditRolePageProps {
    params: Promise<{ org: string; id: string }>;
}

export const metadata = { title: "Edit Role — Logger" };

export default async function EditRolePage({ params }: EditRolePageProps) {
    const { org: slug, id: roleId } = await params;

    const user = await getCurrentUser();
    if (!user) redirect("/login");

    const org = await getOrgBySlug(slug);
    if (!org) notFound();

    const membership = await getMembership(user.id, org.id);
    if (!membership) redirect("/login");

    if (!membership.isOwner) notFound();

    const role = await getRoleById(roleId, org.id);
    if (!role) notFound();

    return (
        <main className={styles.root}>
            <RoleEditor orgSlug={slug} role={role} />
        </main>
    );
}
