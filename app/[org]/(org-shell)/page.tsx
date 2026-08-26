import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/core/auth/server";
import { getOrgBySlug, getMembership } from "@/features/organizations/services/organizations.service";
import { listProjectsForOrg } from "@/features/projects/services/projects.service";
import { listAlertRules } from "@/features/alerts/services/alert-rules.service";
import { parseDashboardFilters, resolveRange } from "@/shared/utils/dashboard-filters";
import {
    cachedProjectStats,
    cachedTopMessagePerProject,
    cachedLevelBreakdown,
    cachedTopErrors,
    cachedEnvironments,
    cachedEventBuckets,
} from "@/shared/services/event-aggregations-cache.service";
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

    // "coarse": this chart draws one series per project, so it trades chart
    // resolution for a readable number of marks. See `BucketDensity`.
    const filters = parseDashboardFilters(rawSearch, "coarse");
    const dateRange = resolveRange(filters.range);

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
    //
    // These are the `cached*` wrappers, not the services themselves: every
    // reader of an organization asks the same question, so it is answered once
    // per 30 s and shared (`event-aggregations-cache.service.ts`). Both the preset and
    // the resolved range are passed — the preset keys the cache, the range is
    // used only when the query actually runs. Keying on the range instead
    // would key on `Date.now()` and never hit.
    // Two promises where there was one until 2026-08-20. Under Postgres the
    // statistics were rollup-backed and landed in ~30 ms while the per-project
    // top message was a message-keyed aggregation over raw `events` and took
    // ~954 ms on staging; behind a single promise, every consumer of the cheap
    // half waited for the expensive one — including the KPI row, which does not
    // display a message at all. Both are one ClickHouse query now and the gap
    // is unmeasured, so the split stays until a measurement says it need not.
    const statsPromise = cachedProjectStats(
        projectIds,
        filters.preset,
        dateRange,
        filters.environmentsFilter,
    );
    const topMessagesPromise = cachedTopMessagePerProject(
        projectIds,
        filters.preset,
        dateRange,
        filters.environmentsFilter,
    );
    // Top errors was the one widget no rollup could serve, so its cost scaled
    // with the rows it matched and its window is capped independently of the
    // page's — see `clampTopErrorsWindow`. The cap outlived its reason and is
    // kept deliberately: 30 days of errors is the page's worst case and one
    // click away, and nothing has measured what it costs here yet. The cache is
    // keyed on the capped window, which is the range this actually asks for.
    const topErrorsWindow = clampTopErrorsWindow(filters.preset);
    const topErrorsPromise = cachedTopErrors(
        projectIds,
        topErrorsWindow.preset,
        resolveRange({ type: "preset", value: topErrorsWindow.preset }),
        filters.environmentsFilter,
    );
    const levelBreakdownPromise = cachedLevelBreakdown(
        projectIds,
        filters.preset,
        dateRange,
        filters.environmentsFilter,
    );
    const environmentsPromise = cachedEnvironments(projectIds);
    // The environment filter reaches this since 2026-08-25. It did not before —
    // the chart was the one widget on the page that ignored the filter bar.
    const bucketsPromise = cachedEventBuckets(
        projectIds,
        filters.preset,
        dateRange,
        filters.bucketSecs,
        filters.environmentsFilter,
    );

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
            environment={filters.environment}
            environmentsPromise={environmentsPromise}
            statsPromise={statsPromise}
            topMessagesPromise={topMessagesPromise}
            alertRulesPromise={alertRulesPromise}
            topErrorsPromise={topErrorsPromise}
            topErrorsWindow={topErrorsWindow}
            levelBreakdownPromise={levelBreakdownPromise}
            bucketsPromise={bucketsPromise}
        />
    );
}
