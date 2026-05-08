"use client";

import { usePathname } from "next/navigation";
import { Sidebar, SidebarSection, SidebarItem, SidebarDivider } from "@/shared/components";

interface ProjectSidebarProps {
    orgSlug: string;
    projectSlug: string;
    projectName: string;
}

export function ProjectSidebar({ orgSlug, projectSlug, projectName: _projectName }: ProjectSidebarProps) {
    const pathname = usePathname();
    const base = `/${orgSlug}/${projectSlug}`;

    const is = (path: string) => pathname === `${base}${path}`;
    const startsWith = (path: string) => pathname.startsWith(`${base}${path}`);

    return (
        <Sidebar ariaLabel="Project navigation">
            <SidebarSection>
                <SidebarItem
                    label="Dashboard"
                    href={base}
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
                    label="Events"
                    href={`${base}/events`}
                    active={startsWith("/events")}
                    icon={
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                            <polyline points="2 8 5 4 8 10 11 6 14 8" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                    }
                />
                <SidebarItem
                    label="Alerts"
                    active={startsWith("/alerts")}
                    icon={
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                            <path d="M8 2a5 5 0 0 1 5 5v2l1 2H2l1-2V7a5 5 0 0 1 5-5z" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
                            <path d="M6.5 13a1.5 1.5 0 0 0 3 0" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
                        </svg>
                    }
                />
            </SidebarSection>

            <SidebarDivider />

            <SidebarSection label="Settings">
                <SidebarItem
                    label="General"
                    href={`${base}/settings`}
                    active={is("/settings")}
                    icon={
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                            <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.25" />
                            <path d="M8 2v1.5M8 12.5V14M2 8h1.5M12.5 8H14M3.5 3.5l1 1M11.5 11.5l1 1M3.5 12.5l1-1M11.5 4.5l1-1" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
                        </svg>
                    }
                />
                <SidebarItem
                    label="API keys"
                    href={`${base}/settings/api-keys`}
                    active={startsWith("/settings/api-keys")}
                    icon={
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                            <circle cx="6" cy="9" r="3" stroke="currentColor" strokeWidth="1.25" />
                            <path d="M9 6.5l5-4.5M14 2l-1.5 1.5M11.5 4.5l1.5 1" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                    }
                />
                <SidebarItem
                    label="Danger zone"
                    href={`${base}/settings/danger`}
                    active={is("/settings/danger")}
                    className="dangerItem"
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
