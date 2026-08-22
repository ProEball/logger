import { Suspense, type ReactNode } from "react";
import { ProjectsSection } from "@/features/overview/components/ProjectsSection/ProjectsSection";
import { buildProjectRows } from "@/features/overview/utils/build-project-rows";
import type { AlertRuleFlags, OverviewProject } from "@/features/overview/utils/build-project-rows";
import type { ProjectStats, ProjectTopMessage } from "@/features/overview/services/overview.service";
import {
    TopMessageSlot,
    TopMessageSkeleton,
} from "@/features/overview/components/OverviewProjectsPanel/parts/TopMessageSlot";

interface OverviewProjectsPanelProps {
    projects: OverviewProject[];
    orgSlug: string;
    statsPromise: Promise<Map<string, ProjectStats>>;
    topMessagesPromise: Promise<Map<string, ProjectTopMessage>>;
    alertRulesPromise: Promise<Map<string, AlertRuleFlags[]>>;
}

/**
 * Awaits the statistics and alert rules — both cheap — and renders immediately.
 *
 * **It does not await `topMessagesPromise`.** That query costs ~954 ms against
 * ~30 ms for everything else on this panel, so awaiting it here would put the
 * whole projects table behind it, which is exactly what this split undid. The
 * promise is instead captured in a per-project `Suspense` boundary and handed
 * to the section as a `ReactNode`.
 *
 * Two slot maps because the two views clip the message differently and only one
 * is mounted at a time. Both sets render on the server, but they share a single
 * promise, so this costs a few extra elements in the payload and **not** a
 * second query.
 */
export async function OverviewProjectsPanel({
    projects,
    orgSlug,
    statsPromise,
    topMessagesPromise,
    alertRulesPromise,
}: OverviewProjectsPanelProps) {
    const [stats, alertRules] = await Promise.all([statsPromise, alertRulesPromise]);

    const slotsFor = (variant: "table" | "card"): Record<string, ReactNode> =>
        Object.fromEntries(
            projects.map((project) => [
                project.id,
                <Suspense key={project.id} fallback={<TopMessageSkeleton variant={variant} />}>
                    <TopMessageSlot
                        projectId={project.id}
                        variant={variant}
                        topMessagesPromise={topMessagesPromise}
                    />
                </Suspense>,
            ]),
        );

    return (
        <ProjectsSection
            rows={buildProjectRows(projects, stats, alertRules)}
            orgSlug={orgSlug}
            tableTopMessages={slotsFor("table")}
            cardTopMessages={slotsFor("card")}
        />
    );
}
