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
import { OverviewPage } from "@/features/overview/components/OverviewPage/OverviewPage";
import type { AlertRule } from "@/core/db/schema";
import type { ProjectRow } from "@/features/overview/services/overview.service";

const VALID_PRESETS = new Set(["15m", "1h", "6h", "24h", "7d", "30d"]);

const BUCKET_SECS: Record<string, number> = {
    "15m": 60,
    "1h":  300,
    "6h":  900,
    "24h": 3600,
    "7d":  3600 * 6,
    "30d": 3600 * 24,
};

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

    // Parse filters from URL search params
    const rawRange = typeof rawSearch.range === "string" ? rawSearch.range : "1h";
    const rangePreset = VALID_PRESETS.has(rawRange) ? rawRange : "1h";
    const { from, to } = resolveRange({ type: "preset", value: rangePreset as "1h" });
    const dateRange = { from, to };

    const rawLevels = typeof rawSearch.levels === "string" ? rawSearch.levels : "";
    const levels = rawLevels ? rawLevels.split(",").filter(Boolean) : [];
    const environment = typeof rawSearch.env === "string" ? rawSearch.env : "";
    const environments_filter = environment ? [environment] : undefined;

    // Reconstruct search string for client filter bar
    const searchString = Object.entries(rawSearch)
        .filter(([, v]) => typeof v === "string" && v !== "")
        .map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`)
        .join("&");

    const projects = await listProjectsForOrg(org.id);
    const projectIds = projects.map((p) => p.id);

    const bucketSecs = BUCKET_SECS[rangePreset] ?? 3600;

    const [summaries, topErrors, levelBreakdown, environments, alertRulesResults, buckets] = await Promise.all([
        getProjectSummaries(projectIds, dateRange, levels.length > 0 ? levels : undefined, environments_filter),
        getOrgTopErrors(projectIds, dateRange, levels.length > 0 ? levels : undefined, environments_filter),
        getOrgLevelBreakdown(projectIds, dateRange, environments_filter),
        getOrgEnvironments(projectIds),
        Promise.all(projects.map((p) => listAlertRules(p.id, membership, true))),
        getOrgEventBuckets(projectIds, dateRange, bucketSecs),
    ]);

    const alertRulesByProject = new Map<string, AlertRule[]>();
    projects.forEach((p, i) => {
        alertRulesByProject.set(p.id, alertRulesResults[i]);
    });

    const projectRows: ProjectRow[] = projects.map((project) => {
        const summary = summaries.get(project.id);
        const rules = alertRulesByProject.get(project.id) ?? [];
        return {
            project: { id: project.id, slug: project.slug, name: project.name },
            totalEvents: summary?.totalEvents ?? 0,
            errorCount: summary?.errorCount ?? 0,
            environments: summary?.environments ?? [],
            topMessage: summary?.topMessage ?? null,
            topMessageLevel: summary?.topMessageLevel ?? null,
            firingAlertsCount: rules.filter((r) => r.enabled && r.state === "firing").length,
            enabledAlertsCount: rules.filter((r) => r.enabled).length,
        };
    });

    return (
        <OverviewPage
            orgSlug={org.slug}
            projects={projects}
            range={rangePreset}
            levels={levels}
            environment={environment}
            environments={environments}
            searchString={searchString}
            projectRows={projectRows}
            topErrors={topErrors}
            levelBreakdown={levelBreakdown}
            buckets={buckets}
        />
    );
}
