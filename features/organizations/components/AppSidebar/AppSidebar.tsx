"use client";

import React from "react";
import { usePathname, useRouter } from "next/navigation";
import { Sidebar } from "@/shared/components";
import { SidebarItem } from "@/shared/components/Sidebar/parts/SidebarItem";
import { SidebarSection } from "@/shared/components/Sidebar/parts/SidebarSection";
import { SidebarDivider } from "@/shared/components/Sidebar/parts/SidebarDivider";
import sidebarStyles from "@/shared/components/Sidebar/Sidebar.module.scss";
import styles from "./AppSidebar.module.scss";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Project {
    id: string;
    name: string;
    slug: string;
}

interface AppSidebarProps {
    orgSlug: string;
    orgName: string;
    projects: Project[];
    activeProjectSlug?: string;
    userName?: string;
    userEmail?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function userInitials(name: string): string {
    return name
        .split(" ")
        .filter(Boolean)
        .map((p) => p[0])
        .join("")
        .toUpperCase()
        .slice(0, 2);
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function IconGrid() {
    return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.25" />
            <rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.25" />
            <rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.25" />
            <rect x="9" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.25" />
        </svg>
    );
}

function IconActivity() {
    return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <polyline points="2 8 5 4 8 10 11 6 14 8" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

function IconBell() {
    return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M8 2a5 5 0 0 1 5 5v2l1 2H2l1-2V7a5 5 0 0 1 5-5z" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
            <path d="M6.5 13a1.5 1.5 0 0 0 3 0" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
        </svg>
    );
}

function IconUsers() {
    return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="6" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.25" />
            <path d="M1.5 13c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
            <circle cx="11.5" cy="5.5" r="2" stroke="currentColor" strokeWidth="1.25" />
            <path d="M13.5 13c0-1.8-1-3-2.5-3.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
        </svg>
    );
}

function IconSettings() {
    return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.25" />
            <path d="M8 2v1.5M8 12.5V14M2 8h1.5M12.5 8H14M3.5 3.5l1 1M11.5 11.5l1 1M3.5 12.5l1-1M11.5 4.5l1-1" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
        </svg>
    );
}

function ProjectDot({ active }: { active: boolean }) {
    return (
        <span
            className={styles.projectDot}
            aria-hidden="true"
            style={
                active
                    ? { background: "var(--green)", boxShadow: "0 0 6px var(--green)" }
                    : undefined
            }
        />
    );
}

function IconKey() {
    return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="6" cy="9" r="3" stroke="currentColor" strokeWidth="1.25" />
            <path d="M9 6.5l5-4.5M14 2l-1.5 1.5M11.5 4.5l1.5 1" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

// ── Project nav definition ─────────────────────────────────────────────────────

type ProjectNavItem = {
    id: string;
    label: string;
    path: string;
    icon: React.ReactNode;
};

const PROJECT_NAV: ProjectNavItem[] = [
    { id: "dashboard", label: "Dashboard", path: "", icon: <IconGrid /> },
    { id: "events", label: "Events", path: "/events", icon: <IconActivity /> },
    { id: "alerts", label: "Alerts", path: "/alerts", icon: <IconBell /> },
    { id: "api-keys", label: "API keys", path: "/settings/api-keys", icon: <IconKey /> },
    { id: "settings", label: "Settings", path: "/settings", icon: <IconSettings /> },
];

// ── Component ─────────────────────────────────────────────────────────────────

export function AppSidebar({
    orgSlug,
    orgName,
    projects,
    activeProjectSlug,
    userName,
    userEmail,
}: AppSidebarProps) {
    const pathname = usePathname();
    const router = useRouter();

    const isOrgExact = (path: string) => pathname === `/${orgSlug}${path}`;
    const orgStartsWith = (path: string) => pathname.startsWith(`/${orgSlug}${path}`);

    const isProjectActive = (slug: string): boolean => {
        if (activeProjectSlug) return activeProjectSlug === slug;
        const base = `/${orgSlug}/${slug}`;
        return pathname === base || pathname.startsWith(`${base}/`);
    };

    const top = (
        <div className={styles.orgRow}>
            <div className={styles.orgIcon}>{orgName.slice(0, 2).toUpperCase()}</div>
            <div className={styles.orgInfo}>
                <b>{orgName}</b>
                <span>
                    {projects.length} project{projects.length !== 1 ? "s" : ""}
                </span>
            </div>
        </div>
    );

    const bottom =
        userName || userEmail ? (
            <div className={styles.userRow}>
                <div className={styles.userAvatar}>
                    {userName ? userInitials(userName) : "?"}
                </div>
                <div className={styles.userInfo}>
                    {userName && <b>{userName}</b>}
                    {userEmail && <span>{userEmail}</span>}
                </div>
            </div>
        ) : undefined;

    return (
        <Sidebar ariaLabel="Application navigation" top={top} bottom={bottom}>
            {/* Org-level navigation */}
            <SidebarSection label="Organization">
                <SidebarItem
                    label="Overview"
                    href={`/${orgSlug}`}
                    active={isOrgExact("")}
                    icon={<IconGrid />}
                />
                <SidebarItem
                    label="Team"
                    href={`/${orgSlug}/team`}
                    active={orgStartsWith("/team")}
                    icon={<IconUsers />}
                />
                <SidebarItem
                    label="Settings"
                    href={`/${orgSlug}/settings`}
                    active={orgStartsWith("/settings")}
                    icon={<IconSettings />}
                />
            </SidebarSection>

            <SidebarDivider />

            {/* Projects list */}
            <SidebarSection
                label="Projects"
                onAdd={() => router.push(`/${orgSlug}/projects/new`)}
            >
                {projects.map((project) => {
                    const projectBase = `/${orgSlug}/${project.slug}`;
                    const active = isProjectActive(project.slug);

                    // Pick the most-specific matching nav item to avoid parent/child conflicts
                    // e.g. /settings and /settings/api-keys both satisfy startsWith(/settings)
                    const activeNavId = active
                        ? PROJECT_NAV.reduce<string | null>((best, n) => {
                            const href = `${projectBase}${n.path}`;
                            const matches =
                                n.path === ""
                                    ? pathname === projectBase
                                    : pathname === href || pathname.startsWith(`${href}/`);
                            if (!matches) return best;
                            if (best === null) return n.id;
                            const bestItem = PROJECT_NAV.find((x) => x.id === best)!;
                            return href.length > `${projectBase}${bestItem.path}`.length
                                ? n.id
                                : best;
                        }, null)
                        : null;

                    return (
                        <React.Fragment key={project.id}>
                            <SidebarItem
                                label={project.name}
                                href={projectBase}
                                active={active && pathname === projectBase}
                                icon={<ProjectDot active={active} />}
                            />

                            {/* Inline project nav when this project is active */}
                            {active && (
                                <div className={styles.projectTree}>
                                    {PROJECT_NAV.map((n) => {
                                        const href = `${projectBase}${n.path}`;
                                        return (
                                            <SidebarItem
                                                key={n.id}
                                                label={n.label}
                                                href={href}
                                                active={n.id === activeNavId}
                                                icon={n.icon}
                                                className={sidebarStyles.treeItem}
                                            />
                                        );
                                    })}
                                </div>
                            )}
                        </React.Fragment>
                    );
                })}
            </SidebarSection>
        </Sidebar>
    );
}
