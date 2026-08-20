import type { ProjectEventSummary, ProjectRow } from "@/features/overview/services/overview.service";

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
 * Join projects with their event summaries and alert rules into table rows.
 *
 * The project list is the spine: a project with no events in the range still
 * gets a row, with zeros. That is deliberate — dropping it would make a quiet
 * project vanish from the overview, which reads as "deleted" rather than
 * "quiet".
 */
export function buildProjectRows(
    projects: OverviewProject[],
    summaries: Map<string, ProjectEventSummary>,
    alertRulesByProject: Map<string, AlertRuleFlags[]>,
): ProjectRow[] {
    return projects.map((project) => {
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
