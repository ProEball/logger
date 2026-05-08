import { redirect } from "next/navigation";
import { getCurrentUser } from "@/core/auth/server";
import { getMembership, getOrgBySlug } from "@/features/organizations/services/organizations.service";
import { getProjectBySlug } from "@/features/projects/services/projects.service";
import { hasPermission } from "@/shared/permissions/check";
import { ProjectDangerZone } from "@/features/projects/components/ProjectDangerZone/ProjectDangerZone";

interface ProjectDangerPageProps {
    params: Promise<{ org: string; project: string }>;
}

export default async function ProjectDangerPage({ params }: ProjectDangerPageProps) {
    const { org: orgSlug, project: projectSlug } = await params;

    const user = await getCurrentUser();
    if (!user) redirect("/login");

    const org = await getOrgBySlug(orgSlug);
    if (!org) redirect("/login");

    const membership = await getMembership(user.id, org.id);
    if (!membership || !hasPermission(membership, "projects.delete")) {
        redirect(`/${orgSlug}/${projectSlug}/settings`);
    }

    const project = await getProjectBySlug(org.id, projectSlug);
    if (!project) redirect(`/${orgSlug}/projects`);

    return (
        <ProjectDangerZone
            orgSlug={orgSlug}
            projectSlug={project.slug}
            projectName={project.name}
        />
    );
}
