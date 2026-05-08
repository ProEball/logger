import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/core/auth/server";
import { getMembership, getOrgBySlug } from "@/features/organizations/services/organizations.service";
import { getProjectBySlug } from "@/features/projects/services/projects.service";
import { ProjectHydrator } from "@/core/store/ProjectHydrator";
import { ProjectSidebar } from "@/features/projects/components/ProjectSidebar/ProjectSidebar";
import { AppShell } from "@/shared/components";
import { OrgHydrator } from "@/core/store/OrgHydrator";
import { OrgTopBar } from "@/features/organizations/components/OrgTopBar/OrgTopBar";
import { getThemeFromCookie } from "@/core/theme/cookie";
import { getUserOrgs } from "@/features/organizations/services/organizations.service";
import type { ThemeValue } from "@/core/store/slices/theme";
import { parsePreferences } from "@/shared/types/user-preferences.types";

interface ProjectLayoutProps {
    children: React.ReactNode;
    params: Promise<{ org: string; project: string }>;
}

export default async function ProjectLayout({ children, params }: ProjectLayoutProps) {
    const { org: orgSlug, project: projectSlug } = await params;

    const user = await getCurrentUser();
    if (!user) redirect("/login");

    const org = await getOrgBySlug(orgSlug);
    if (!org) notFound();

    const membership = await getMembership(user.id, org.id);
    if (!membership) redirect("/login");

    const project = await getProjectBySlug(org.id, projectSlug);
    if (!project) notFound();

    const preferences = parsePreferences(user.preferences);
    const cookieTheme = await getThemeFromCookie();
    const theme: ThemeValue = preferences.theme ?? cookieTheme;

    const userOrgs = await getUserOrgs(user.id);

    return (
        <>
            <OrgHydrator
                orgId={org.id}
                orgSlug={org.slug}
                membership={membership}
                theme={theme}
                preferences={preferences}
            />
            <ProjectHydrator
                projectId={project.id}
                projectSlug={project.slug}
                projectName={project.name}
                orgId={org.id}
            />
            <AppShell
                sidebar={
                    <ProjectSidebar
                        orgSlug={orgSlug}
                        projectSlug={projectSlug}
                        projectName={project.name}
                    />
                }
                topbar={
                    <OrgTopBar
                        orgSlug={orgSlug}
                        orgName={org.name}
                        orgs={userOrgs}
                        userName={user.name}
                        userEmail={user.email}
                    />
                }
            >
                {children}
            </AppShell>
        </>
    );
}
