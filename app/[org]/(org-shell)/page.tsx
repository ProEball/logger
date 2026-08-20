import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/core/auth/server";
import { getOrgBySlug, getMembership } from "@/features/organizations/services/organizations.service";
import { listProjectsForOrg } from "@/features/projects/services/projects.service";
import { listAlertRules } from "@/features/alerts/services/alert-rules.service";
import { resolveRange } from "@/features/dashboard/utils/aggregation-utils";
import {
    getProjectSummaries,
    getOrgLevelBreakdown,
    getOrgTopErrors,
    getOrgEnvironments,
    getOrgEventBuckets,
} from "@/features/overview/services/overview.service";
import { parseOverviewFilters } from "@/features/overview/utils/overview-filters";
import { clampTopErrorsWindow } from "@/features/overview/utils/top-errors-window";
import type { AlertRuleFlags } from "@/features/overview/utils/build-project-rows";
import { OverviewPage } from "@/features/overview/components/OverviewPage/OverviewPage";

interface OrgPageProps {
    params: Promise<{ org: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function OrgPage({ params, searchParams }: OrgPageProps) {
    const [{ org: slug }, rawSearch] = await Promise.all([params, searchParams]);

    const user = await getCurrentUser();
    if (!user) redirect("/login");

    const org = await getOrgBySlug(slug);
    if (!org) notFound();

    const membership = await getMembership(user.id, org.id);
    if (!membership) redirect("/login");

    const filters = parseOverviewFilters(rawSearch);
    const dateRange = resolveRange({ type: "preset", value: filters.preset });

    // Awaited: the project list decides what every other query is scoped to,
    // and the page has nothing to render without it.
    const projects = await listProjectsForOrg(org.id);
    const projectIds = projects.map((p) => p.id);

    // NOT awaited. Each query is started here and handed to the section that
    // draws it, so a slow aggregation delays only its own widget instead of the
    // whole page (`PLAN.md` §16.1 Stage D). Sections that need the same data
    // receive the same promise and share one query.
    //
    // Starting them here rather than inside the sections also keeps the
    // cross-feature calls — projects, alert rules — in the route, which §2.3
    // permits, instead of making `features/overview` import two other features
    // against §2.1.
    const summariesPromise = getProjectSummaries(
        projectIds,
        dateRange,
        filters.levelsFilter,
        filters.environmentsFilter,
    );
    // Top errors is the one widget that cannot come from the rollup, so its
    // cost scales with the rows it matches. Its window is capped independently
    // of the page's — see `clampTopErrorsWindow`.
    const topErrorsWindow = clampTopErrorsWindow(filters.preset);
    const topErrorsPromise = getOrgTopErrors(
        projectIds,
        resolveRange({ type: "preset", value: topErrorsWindow.preset }),
        filters.levelsFilter,
        filters.environmentsFilter,
    );
    const levelBreakdownPromise = getOrgLevelBreakdown(projectIds, dateRange, filters.environmentsFilter);
    const environmentsPromise = getOrgEnvironments(projectIds);
    const bucketsPromise = getOrgEventBuckets(projectIds, dateRange, filters.bucketSecs);

    const alertRulesPromise = Promise.all(
        projects.map((p) => listAlertRules(p.id, membership, true)),
    ).then((results) => {
        const byProject = new Map<string, AlertRuleFlags[]>();
        projects.forEach((p, i) => byProject.set(p.id, results[i]));
        return byProject;
    });

    return (
        <OverviewPage
            orgSlug={org.slug}
            projects={projects}
            range={filters.preset}
            levels={filters.levels}
            environment={filters.environment}
            environmentsPromise={environmentsPromise}
            searchString={filters.searchString}
            summariesPromise={summariesPromise}
            alertRulesPromise={alertRulesPromise}
            topErrorsPromise={topErrorsPromise}
            topErrorsWindow={topErrorsWindow}
            levelBreakdownPromise={levelBreakdownPromise}
            bucketsPromise={bucketsPromise}
        />
    );
}
