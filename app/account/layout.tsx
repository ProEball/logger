import { redirect } from "next/navigation";
import { AppShell } from "@/shared/components";
import { OrgHydrator } from "@/core/store/OrgHydrator";
import { getCurrentUser } from "@/core/auth/server";
import { getThemeFromCookie } from "@/core/theme/cookie";
import type { ThemeValue } from "@/core/store/slices/theme";
import { getFirstOrgForUser, getMembership } from "@/features/organizations/services/organizations.service";
import { listProjectsForOrg } from "@/features/projects/services/projects.service";
import { AppSidebar } from "@/features/organizations/components/AppSidebar/AppSidebar";
import { OrgTopBar } from "@/features/organizations/components/OrgTopBar/OrgTopBar";
import { parsePreferences } from "@/shared/types/user-preferences.types";

interface AccountLayoutProps {
    children: React.ReactNode;
}

export default async function AccountLayout({ children }: AccountLayoutProps) {
    const user = await getCurrentUser();
    if (!user) redirect("/login");

    const org = await getFirstOrgForUser(user.id);
    if (!org) {
        // No org membership yet — render account pages without the app shell.
        return <>{children}</>;
    }

    const membership = await getMembership(user.id, org.id);

    const preferences = parsePreferences(user.preferences);
    const cookieTheme = await getThemeFromCookie();
    const theme: ThemeValue = preferences.theme ?? cookieTheme;

    const projects = await listProjectsForOrg(org.id);

    return (
        <>
            {membership ? (
                <OrgHydrator
                    orgId={org.id}
                    orgSlug={org.slug}
                    membership={membership}
                    theme={theme}
                    preferences={preferences}
                />
            ) : null}
            <AppShell
                sidebar={
                    <AppSidebar
                        orgSlug={org.slug}
                        orgName={org.name}
                        projects={projects}
                    />
                }
            >
                <OrgTopBar userName={user.name} userEmail={user.email} />
                {children}
            </AppShell>
        </>
    );
}
