import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/shared/components";
import { getCurrentUser } from "@/core/auth/server";
import { getMembership, getOrgBySlug } from "@/features/organizations/services/organizations.service";
import { listProjectsForOrg } from "@/features/projects/services/projects.service";
import { ProjectsList } from "@/features/projects/components/ProjectsList/ProjectsList";
import { hasPermission } from "@/shared/permissions/check";
import styles from "./page.module.scss";

interface ProjectsPageProps {
    params: Promise<{ org: string }>;
}

export default async function ProjectsPage({ params }: ProjectsPageProps) {
    const { org: orgSlug } = await params;

    const user = await getCurrentUser();
    if (!user) redirect("/login");

    const org = await getOrgBySlug(orgSlug);
    if (!org) redirect("/login");

    const membership = await getMembership(user.id, org.id);
    if (!membership) redirect("/login");

    const projects = await listProjectsForOrg(org.id);
    const canCreate = hasPermission(membership, "projects.create");

    return (
        <div className={styles.page}>
            <div className={styles.header}>
                <h1 className={styles.title}>Projects</h1>
                {canCreate && (
                    <Link href={`/${orgSlug}/projects/new`}>
                        <Button variant="primary" size="sm">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                            </svg>
                            New project
                        </Button>
                    </Link>
                )}
            </div>
            <ProjectsList projects={projects} orgSlug={orgSlug} canCreate={canCreate} />
        </div>
    );
}
