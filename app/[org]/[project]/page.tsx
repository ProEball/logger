import { notFound, redirect } from "next/navigation";
import type { SearchParams } from "next/dist/server/request/search-params";
import { getCurrentUser } from "@/core/auth/server";
import { getOrgBySlug } from "@/features/organizations/services/organizations.service";
import { getMembership } from "@/features/organizations/services/organizations.service";
import { getProjectBySlug } from "@/features/projects/services/projects.service";
import { listApiKeysForProject } from "@/features/api-keys/services/api-keys.service";
import { hasAnyEvents } from "@/shared/services/event-aggregations.service";
import {
    cachedEnvironments,
    cachedEventBucketsByLevel,
    cachedLevelBreakdown,
    cachedRecentErrors,
    cachedTopMessages,
    cachedTopSources,
} from "@/shared/services/event-aggregations-cache.service";
import { listAlertRules } from "@/features/alerts/services/alert-rules.service";
import { DashboardPage } from "@/features/dashboard/components/DashboardPage/DashboardPage";
import { EmptyProjectState } from "@/features/dashboard/components/EmptyProjectState/EmptyProjectState";
import { parseDashboardFilters, resolveRange } from "@/shared/utils/dashboard-filters";

interface DashboardRouteProps {
    params: Promise<{ org: string; project: string }>;
    searchParams: Promise<SearchParams>;
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
    const anyEvents = await hasAnyEvents([project.id]);
    if (!anyEvents) {
        const keys = await listApiKeysForProject(project.id);
        const activeKey = keys.find((k) => !k.revokedAt);
        return (
            <EmptyProjectState
                projectName={project.name}
                orgSlug={orgSlug}
                projectSlug={projectSlug}
                apiKeyPrefix={activeKey?.keyPrefix}
            />
        );
    }

    // "fine": this chart draws one project, so its 1-hour view stays a live
    // minute-by-minute tail. Every other width matches the overview.
    const filters = parseDashboardFilters(sp, "fine");
    const range = filters.range;
    const dateRange = resolveRange(range);
    const ids = [project.id];

    // NOT awaited. Each query is started here and handed to the section that
    // draws it, so a slow aggregation delays only its own widget instead of the
    // whole page — the same shape the org overview took in §16.1 Stage D.
    //
    // Measured before the change (`event-aggregations.service.bench.ts`): `topMessages`
    // 170 ms, `eventsPerMinute` 44.2, `levelBreakdown` 11.6, `topSources` 11.2,
    // `recentErrors` 0.84. Behind one `Promise.all` the page showed nothing for
    // 170 ms; now everything but the last paints at ~45.
    //
    // These are the `cached*` wrappers: every reader of a project asks the same
    // question, so it is answered once per 30 s and shared. `hasAnyEvents` is
    // deliberately not among them — it gates the onboarding screen, and the one
    // moment its answer changes is the one moment a stale "no events yet" would
    // be worst.
    //
    // The live rate is not started here either: it moved to the application top
    // bar on 2026-08-25, so the project layout owns that query now. Being in a
    // layout is what makes it unfiltered by environment - see `ProjectPulse`.
    return (
        <DashboardPage
            orgSlug={orgSlug}
            projectSlug={projectSlug}
            range={range}
            rangePreset={filters.preset}
            environment={filters.environment}
            environmentsPromise={cachedEnvironments(ids)}
            eventsPerMinPromise={cachedEventBucketsByLevel(ids, filters.preset, dateRange, filters.bucketSecs, filters.environmentsFilter)}
            levelBreakdownPromise={cachedLevelBreakdown(ids, filters.preset, dateRange, filters.environmentsFilter)}
            topMessagesPromise={cachedTopMessages(ids, filters.preset, dateRange, filters.environmentsFilter)}
            recentErrorsPromise={cachedRecentErrors(ids, filters.preset, dateRange, filters.environmentsFilter)}
            topSourcesPromise={cachedTopSources(ids, filters.preset, dateRange, filters.environmentsFilter)}
            alertRulesPromise={listAlertRules(project.id, membership)}
        />
    );
}
