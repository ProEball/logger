import { redirect } from "next/navigation";
import { getCurrentUser } from "@/core/auth/server";
import { getMembership, getOrgBySlug } from "@/features/organizations/services/organizations.service";
import { getProjectBySlug } from "@/features/projects/services/projects.service";
import { listApiKeysForProject } from "@/features/api-keys/services/api-keys.service";
import { hasPermission } from "@/shared/permissions/check";
import { ApiKeysList } from "@/features/api-keys/components/ApiKeysList/ApiKeysList";
import { ApiKeysPageHeader } from "@/features/api-keys/components/ApiKeysPageHeader/ApiKeysPageHeader";
import styles from "./page.module.scss";

interface ApiKeysPageProps {
    params: Promise<{ org: string; project: string }>;
}

export default async function ApiKeysPage({ params }: ApiKeysPageProps) {
    const { org: orgSlug, project: projectSlug } = await params;

    const user = await getCurrentUser();
    if (!user) redirect("/login");

    const org = await getOrgBySlug(orgSlug);
    if (!org) redirect("/login");

    const membership = await getMembership(user.id, org.id);
    if (!membership) redirect("/login");

    const project = await getProjectBySlug(org.id, projectSlug);
    if (!project) redirect(`/${orgSlug}/projects`);

    const apiKeys = await listApiKeysForProject(project.id);
    const canManage = hasPermission(membership, "api_keys.manage");

    return (
        <div className={styles.page}>
            <ApiKeysPageHeader
                orgSlug={orgSlug}
                projectSlug={projectSlug}
                canManage={canManage}
            />
            <ApiKeysList
                apiKeys={apiKeys}
                orgSlug={orgSlug}
                projectSlug={projectSlug}
                canManage={canManage}
            />
        </div>
    );
}
