import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/core/auth/server";
import { getMembership, getOrgBySlug } from "@/features/organizations/services/organizations.service";
import { getProjectBySlug, listProjectsForOrg } from "@/features/projects/services/projects.service";
import { ProjectHydrator } from "@/core/store/ProjectHydrator";
import { AppSidebar } from "@/features/organizations/components/AppSidebar/AppSidebar";
import { AppShell } from "@/shared/components";
import { OrgHydrator } from "@/core/store/OrgHydrator";
import { OrgTopBar } from "@/features/organizations/components/OrgTopBar/OrgTopBar";
import { ProjectPulse } from "@/features/projects/components/ProjectPulse/ProjectPulse";
import { cachedEventsInLastMinute } from "@/shared/services/event-aggregations-cache.service";
import { getThemeFromCookie } from "@/core/theme/cookie";
import type { ThemeValue } from "@/core/store/slices/theme";
import { hasPermission } from "@/shared/permissions/check";
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

    const projects = await listProjectsForOrg(org.id);

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
                    <AppSidebar
                        orgSlug={orgSlug}
                        orgName={org.name}
                        projects={projects}
                        activeProjectSlug={projectSlug}
                        isOwner={membership.isOwner}
                        canManageOrg={hasPermission(membership, "org.update")}
                    />
                }
            >
                {/*
                  * The rate query is started here and handed down unawaited —
                  * `ProjectPulse` holds the `Suspense` boundary. Awaiting it in
                  * this layout would put the sidebar and every project page
                  * behind an aggregation.
                  *
                  * Unfiltered by environment on purpose: a layout cannot read
                  * `searchParams`, and this is a heartbeat for the project
                  * rather than a statistic about the current view. See the note
                  * on `ProjectPulse`.
                  */}
                <OrgTopBar
                    userName={user.name}
                    userEmail={user.email}
                    left={
                        <ProjectPulse
                            name={project.name}
                            ratePromise={cachedEventsInLastMinute([project.id])}
                        />
                    }
                />
                {children}
            </AppShell>
        </>
    );
}
