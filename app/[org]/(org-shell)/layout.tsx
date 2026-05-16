import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/shared/components";
import { OrgRail } from "@/shared/components/OrgRail/OrgRail";
import { OrgHydrator } from "@/core/store/OrgHydrator";
import { getCurrentUser } from "@/core/auth/server";
import { getThemeFromCookie } from "@/core/theme/cookie";
import type { ThemeValue } from "@/core/store/slices/theme";
import { getMembership, getOrgBySlug, getUserOrgs } from "@/features/organizations/services/organizations.service";
import { listProjectsForOrg } from "@/features/projects/services/projects.service";
import { AppSidebar } from "@/features/organizations/components/AppSidebar/AppSidebar";
import { OrgTopBar } from "@/features/organizations/components/OrgTopBar/OrgTopBar";
import { parsePreferences } from "@/shared/types/user-preferences.types";

interface OrgShellLayoutProps {
    children: React.ReactNode;
    params: Promise<{ org: string }>;
}

export default async function OrgShellLayout({ children, params }: OrgShellLayoutProps) {
    const { org: slug } = await params;

    const user = await getCurrentUser();
    if (!user) redirect("/login");

    const org = await getOrgBySlug(slug);
    if (!org) notFound();

    const membership = await getMembership(user.id, org.id);
    if (!membership) redirect("/login");

    const preferences = parsePreferences(user.preferences);
    const cookieTheme = await getThemeFromCookie();
    const theme: ThemeValue = preferences.theme ?? cookieTheme;

    const [userOrgs, projects] = await Promise.all([
        getUserOrgs(user.id),
        listProjectsForOrg(org.id),
    ]);

    return (
        <>
            <OrgHydrator
                orgId={org.id}
                orgSlug={org.slug}
                membership={membership}
                theme={theme}
                preferences={preferences}
            />
            <AppShell
                rail={<OrgRail orgs={userOrgs} currentOrgSlug={org.slug} />}
                sidebar={
                    <AppSidebar
                        orgSlug={org.slug}
                        orgName={org.name}
                        projects={projects}
                        userName={user.name ?? undefined}
                        userEmail={user.email ?? undefined}
                    />
                }
            >
                <OrgTopBar
                    orgSlug={org.slug}
                    orgName={org.name}
                    orgs={userOrgs}
                    userName={user.name}
                    userEmail={user.email}
                />
                {children}
            </AppShell>
        </>
    );
}
