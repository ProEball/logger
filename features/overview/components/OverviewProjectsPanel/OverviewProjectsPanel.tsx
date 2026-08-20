import { ProjectsSection } from "@/features/overview/components/ProjectsSection/ProjectsSection";
import { buildProjectRows } from "@/features/overview/utils/build-project-rows";
import type { AlertRuleFlags, OverviewProject } from "@/features/overview/utils/build-project-rows";
import type { ProjectEventSummary } from "@/features/overview/services/overview.service";

interface OverviewProjectsPanelProps {
    projects: OverviewProject[];
    orgSlug: string;
    summariesPromise: Promise<Map<string, ProjectEventSummary>>;
    alertRulesPromise: Promise<Map<string, AlertRuleFlags[]>>;
}

/**
 * Awaits the same two promises the KPI row does. They are shared, not
 * re-issued: the route creates each query once and passes the promise to every
 * section that needs it.
 */
export async function OverviewProjectsPanel({
    projects,
    orgSlug,
    summariesPromise,
    alertRulesPromise,
}: OverviewProjectsPanelProps) {
    const [summaries, alertRules] = await Promise.all([summariesPromise, alertRulesPromise]);
    return <ProjectsSection rows={buildProjectRows(projects, summaries, alertRules)} orgSlug={orgSlug} />;
}
