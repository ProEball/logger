import { redirect } from "next/navigation";
import { getCurrentUser } from "@/core/auth/server";
import { getMembership, getOrgBySlug } from "@/features/organizations/services/organizations.service";
import { getProjectBySlug } from "@/features/projects/services/projects.service";
import { hasPermission } from "@/shared/permissions/check";
import { ProjectSettingsForm } from "@/features/projects/components/ProjectSettingsForm/ProjectSettingsForm";
import styles from "./page.module.scss";

interface ProjectSettingsPageProps {
    params: Promise<{ org: string; project: string }>;
}

export default async function ProjectSettingsPage({ params }: ProjectSettingsPageProps) {
    const { org: orgSlug, project: projectSlug } = await params;

    const user = await getCurrentUser();
    if (!user) redirect("/login");

    const org = await getOrgBySlug(orgSlug);
    if (!org) redirect("/login");

    const membership = await getMembership(user.id, org.id);
    if (!membership) redirect("/login");

    const project = await getProjectBySlug(org.id, projectSlug);
    if (!project) redirect(`/${orgSlug}/projects`);

    const canUpdate = hasPermission(membership, "projects.update");

    return (
        <div className={styles.page}>
            <section className={styles.section}>
                <h2 className={styles.sectionTitle}>General</h2>
                <ProjectSettingsForm
                    orgSlug={orgSlug}
                    projectSlug={project.slug}
                    projectName={project.name}
                />
            </section>

            {canUpdate && (
                <>
                    <hr className={styles.divider} />
                    <section className={styles.dangerSection}>
                        <h2 className={styles.sectionTitle}>Danger zone</h2>
                        <div className={styles.dangerRow}>
                            <div className={styles.dangerInfo}>
                                <strong className={styles.dangerLabel}>Delete project</strong>
                                <p className={styles.dangerDesc}>
                                    Permanently soft-deletes this project. All API keys will be revoked immediately.
                                    Events are retained for 30 days.
                                </p>
                            </div>
                            <a href={`/${orgSlug}/${projectSlug}/settings/danger`} className={styles.dangerLink}>
                                Delete project
                            </a>
                        </div>
                    </section>
                </>
            )}
        </div>
    );
}
