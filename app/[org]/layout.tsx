import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/shared/components";
import { OrgHydrator } from "@/core/store/OrgHydrator";
import { getCurrentUser } from "@/core/auth/server";
import { getThemeFromCookie } from "@/core/theme/cookie";
import type { ThemeValue } from "@/core/store/slices/theme";
import { getMembership, getOrgBySlug, getUserOrgs } from "@/features/organizations/services/organizations.service";
import { OrgSidebar } from "@/features/organizations/components/OrgSidebar";
import { OrgTopBar } from "@/features/organizations/components/OrgTopBar";

interface OrgLayoutProps {
    children: React.ReactNode;
    params: Promise<{ org: string }>;
}

export default async function OrgLayout({ children, params }: OrgLayoutProps) {
    const { org: slug } = await params;

    const user = await getCurrentUser();
    if (!user) redirect("/login");

    const org = await getOrgBySlug(slug);
    if (!org) notFound();

    const membership = await getMembership(user.id, org.id);
    if (!membership) redirect("/login");

    // Prefer DB-stored theme; fall back to cookie (handles first load before DB is written)
    const rawPrefs = user.preferences as Record<string, unknown> | null;
    const dbTheme = rawPrefs?.theme as ThemeValue | undefined;
    const cookieTheme = await getThemeFromCookie();
    const theme: ThemeValue = dbTheme ?? cookieTheme;

    const userOrgs = await getUserOrgs(user.id);

    return (
        <>
            <OrgHydrator
                orgId={org.id}
                orgSlug={org.slug}
                membership={membership}
                theme={theme}
            />
            <AppShell
                sidebar={<OrgSidebar orgSlug={org.slug} orgName={org.name} />}
                topbar={
                    <OrgTopBar
                        orgSlug={org.slug}
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
