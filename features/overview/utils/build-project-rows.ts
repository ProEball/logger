import type { ProjectStats, ProjectRow } from "@/features/overview/services/overview.service";

/**
 * Assembly of the overview's per-project table rows, extracted from
 * `app/[org]/(org-shell)/page.tsx` on 2026-08-20 (see `overview-filters.ts`
 * for why).
 */

/** The only two fields of an alert rule this assembly reads. */
export interface AlertRuleFlags {
    enabled: boolean;
    state: string | null;
}

export interface OverviewProject {
    id: string;
    slug: string;
    name: string;
}

/**
 * Join projects with their statistics and alert rules into table rows.
 *
 * The top error message is **not** here. It arrives on a separate promise and
 * renders into its own `Suspense` boundary per row, because that query costs
 * ~954 ms against ~30 ms for everything in this row — see `getProjectStats`.
 *
 * The project list is the spine: a project with no events in the range still
 * gets a row, with zeros. That is deliberate — dropping it would make a quiet
 * project vanish from the overview, which reads as "deleted" rather than
 * "quiet".
 */
export function buildProjectRows(
    projects: OverviewProject[],
    stats: Map<string, ProjectStats>,
    alertRulesByProject: Map<string, AlertRuleFlags[]>,
): ProjectRow[] {
    return projects.map((project) => {
        const projectStats = stats.get(project.id);
        const rules = alertRulesByProject.get(project.id) ?? [];
        return {
            project: { id: project.id, slug: project.slug, name: project.name },
            totalEvents: projectStats?.totalEvents ?? 0,
            errorCount: projectStats?.errorCount ?? 0,
            environments: projectStats?.environments ?? [],
            firingAlertsCount: rules.filter((r) => r.enabled && r.state === "firing").length,
            enabledAlertsCount: rules.filter((r) => r.enabled).length,
        };
    });
}

/** Sum a row field across every project — the overview's KPI numbers. */
export function sumProjectRows(rows: ProjectRow[]): {
    totalEvents: number;
    totalErrors: number;
    firingAlerts: number;
    enabledAlerts: number;
} {
    return rows.reduce(
        (acc, r) => ({
            totalEvents: acc.totalEvents + r.totalEvents,
            totalErrors: acc.totalErrors + r.errorCount,
            firingAlerts: acc.firingAlerts + r.firingAlertsCount,
            enabledAlerts: acc.enabledAlerts + r.enabledAlertsCount,
        }),
        { totalEvents: 0, totalErrors: 0, firingAlerts: 0, enabledAlerts: 0 },
    );
}
