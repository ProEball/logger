import { notFound, redirect } from "next/navigation";
import type { SearchParams } from "next/dist/server/request/search-params";
import { getCurrentUser } from "@/core/auth/server";
import { getOrgBySlug } from "@/features/organizations/services/organizations.service";
import { getMembership } from "@/features/organizations/services/organizations.service";
import { getProjectBySlug } from "@/features/projects/services/projects.service";
import { listApiKeysForProject } from "@/features/api-keys/services/api-keys.service";
import {
    hasAnyEvents,
    eventsPerMinute,
    levelBreakdown,
    environmentBreakdown,
    topMessages,
    recentErrors,
} from "@/features/dashboard/services/aggregations.service";
import { DashboardPage } from "@/features/dashboard/components/DashboardPage/DashboardPage";
import { EmptyProjectState } from "@/features/dashboard/components/EmptyProjectState/EmptyProjectState";
import type { TimeRange, TimeRangePreset } from "@/features/events/utils/event-filters.types";

interface DashboardRouteProps {
    params: Promise<{ org: string; project: string }>;
    searchParams: Promise<SearchParams>;
}

export const dynamic = "force-dynamic";

const VALID_PRESETS = new Set<string>(["15m", "1h", "6h", "24h", "7d", "30d"]);

function parseRange(sp: SearchParams): TimeRange {
    const r = typeof sp.range === "string" ? sp.range : "1h";
    if (VALID_PRESETS.has(r)) {
        return { type: "preset", value: r as TimeRangePreset };
    }
    return { type: "preset", value: "1h" };
}

export default async function DashboardRoute({ params, searchParams }: DashboardRouteProps) {
    const { org: orgSlug, project: projectSlug } = await params;
    const sp = await searchParams;

    const user = await getCurrentUser();
    if (!user) redirect("/login");

    const org = await getOrgBySlug(orgSlug);
    if (!org) notFound();

    const membership = await getMembership(user.id, org.id);
    if (!membership) redirect("/login");

    const project = await getProjectBySlug(org.id, projectSlug);
    if (!project) notFound();

    // Guard: if no events have ever been ingested, show onboarding CTA
    const anyEvents = await hasAnyEvents(project.id);
    if (!anyEvents) {
        const keys = await listApiKeysForProject(project.id);
        const activeKey = keys.find((k) => !k.revokedAt);
        return (
            <EmptyProjectState
                projectName={project.name}
                apiKeyPrefix={activeKey?.keyPrefix}
            />
        );
    }

    const range = parseRange(sp);

    // Run all 5 aggregation queries in parallel
    const [eventsPerMin, levelData, envData, topMsgs, recentErrs] = await Promise.all([
        eventsPerMinute(project.id, range),
        levelBreakdown(project.id, range),
        environmentBreakdown(project.id, range),
        topMessages(project.id, range),
        recentErrors(project.id, range),
    ]);

    return (
        <DashboardPage
            projectName={project.name}
            orgSlug={orgSlug}
            projectSlug={projectSlug}
            range={range}
            eventsPerMin={eventsPerMin}
            levelBreakdown={levelData}
            envBreakdown={envData}
            topMessages={topMsgs}
            recentErrors={recentErrs}
        />
    );
}
