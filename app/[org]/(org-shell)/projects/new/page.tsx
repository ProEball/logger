import { redirect } from "next/navigation";
import { getCurrentUser } from "@/core/auth/server";
import { getMembership, getOrgBySlug } from "@/features/organizations/services/organizations.service";
import { hasPermission } from "@/shared/permissions/check";
import { ProjectCreateForm } from "@/features/projects/components/ProjectCreateForm/ProjectCreateForm";
import styles from "./page.module.scss";

interface NewProjectPageProps {
    params: Promise<{ org: string }>;
}

export default async function NewProjectPage({ params }: NewProjectPageProps) {
    const { org: orgSlug } = await params;

    const user = await getCurrentUser();
    if (!user) redirect("/login");

    const org = await getOrgBySlug(orgSlug);
    if (!org) redirect("/login");

    const membership = await getMembership(user.id, org.id);
    if (!membership || !hasPermission(membership, "projects.create")) {
        redirect(`/${orgSlug}/projects`);
    }

    return (
        <div className={styles.page}>
            <h1 className={styles.title}>New project</h1>
            <ProjectCreateForm orgSlug={orgSlug} />
        </div>
    );
}
