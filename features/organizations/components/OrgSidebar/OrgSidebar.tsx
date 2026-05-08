"use client";

import { usePathname } from "next/navigation";
import { Sidebar } from "@/shared/components";
import { SidebarItem } from "@/shared/components/Sidebar/parts/SidebarItem";
import { SidebarSection } from "@/shared/components/Sidebar/parts/SidebarSection";
import { SidebarDivider } from "@/shared/components/Sidebar/parts/SidebarDivider";
import styles from "./OrgSidebar.module.scss";

interface OrgSidebarProps {
    orgSlug: string;
    orgName: string;
}

export function OrgSidebar({ orgSlug, orgName: _orgName }: OrgSidebarProps) {
    const pathname = usePathname();

    const is = (path: string) => pathname === `/${orgSlug}${path}`;
    const startsWith = (path: string) => pathname.startsWith(`/${orgSlug}${path}`);

    return (
        <Sidebar ariaLabel="Organization navigation">
            <SidebarSection>
                <SidebarItem
                    label="Overview"
                    href={`/${orgSlug}`}
                    active={is("")}
                    icon={
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                            <rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.25" />
                            <rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.25" />
                            <rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.25" />
                            <rect x="9" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.25" />
                        </svg>
                    }
                />
                <SidebarItem
                    label="Projects"
                    href={`/${orgSlug}/projects`}
                    active={startsWith("/projects")}
                    icon={
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                            <path d="M2 4a1 1 0 0 1 1-1h3l1.5 2H13a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4z" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
                        </svg>
                    }
                />
                <SidebarItem
                    label="Team"
                    href={`/${orgSlug}/team`}
                    active={startsWith("/team")}
                    icon={
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                            <circle cx="6" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.25" />
                            <path d="M1.5 13c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
                            <circle cx="11.5" cy="5.5" r="2" stroke="currentColor" strokeWidth="1.25" />
                            <path d="M13.5 13c0-1.8-1-3-2.5-3.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
                        </svg>
                    }
                />
            </SidebarSection>

            <SidebarDivider />

            <SidebarSection label="Settings">
                <SidebarItem
                    label="General"
                    href={`/${orgSlug}/settings`}
                    active={is("/settings")}
                    icon={
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                            <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.25" />
                            <path d="M8 2v1.5M8 12.5V14M2 8h1.5M12.5 8H14M3.5 3.5l1 1M11.5 11.5l1 1M3.5 12.5l1-1M11.5 4.5l1-1" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
                        </svg>
                    }
                />
                <SidebarItem
                    label="Roles"
                    href={`/${orgSlug}/settings/roles`}
                    active={startsWith("/settings/roles")}
                    className={styles.settingsItem}
                    icon={
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                            <path d="M8 2a3 3 0 100 6 3 3 0 000-6zM4 11c0-2.2 1.8-4 4-4h0c2.2 0 4 1.8 4 4v1H4v-1z" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
                            <path d="M11 7.5l1.5 1.5-1.5 1.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                    }
                />
                <SidebarItem
                    label="Danger Zone"
                    href={`/${orgSlug}/settings/danger`}
                    active={is("/settings/danger")}
                    className={styles.dangerItem}
                    icon={
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                            <path d="M8 2L14 13H2L8 2z" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
                            <path d="M8 6v3" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
                            <circle cx="8" cy="11" r="0.75" fill="currentColor" />
                        </svg>
                    }
                />
            </SidebarSection>
        </Sidebar>
    );
}
