import { Suspense } from "react";
import { CardSkeleton, WidgetSkeleton } from "@/shared/components";
import { DashboardFilterBar } from "@/shared/components/DashboardFilterBar/DashboardFilterBar";
import { OverviewKpiRow } from "@/features/overview/components/OverviewKpiRow/OverviewKpiRow";
import { OverviewVolumeSection } from "@/features/overview/components/OverviewVolumeSection/OverviewVolumeSection";
import { OverviewProjectsPanel } from "@/features/overview/components/OverviewProjectsPanel/OverviewProjectsPanel";
import { OverviewTopErrorsPanel } from "@/features/overview/components/OverviewTopErrorsPanel/OverviewTopErrorsPanel";
import { OverviewLevelBreakdownPanel } from "@/features/overview/components/OverviewLevelBreakdownPanel/OverviewLevelBreakdownPanel";
import type {
    ProjectStats,
    ProjectTopMessage,
} from "@/shared/services/event-aggregations.service";
import type { EventBucket } from "@/shared/utils/event-buckets";
import type { LevelCount, TopMessage } from "@/shared/services/event-aggregations.service";
import type { AlertRuleFlags, OverviewProject } from "@/features/overview/utils/build-project-rows";
import type { TopErrorsWindow } from "@/features/overview/utils/top-errors-window";
import styles from "./OverviewPage.module.scss";

/**
 * The organization overview, split into independently streaming sections
 * (2026-08-20, `PLAN.md` §16.1 Stage D).
 *
 * Before this, the route awaited a `Promise.all` of every aggregation and
 * rendered nothing until the slowest returned — so the measured 1.4 s on the
 * staging data was time-to-first-pixel, not time-to-last-widget. `Suspense`
 * was imported here and had nothing to do.
 *
 * **Every data prop is a promise, deliberately.** The route starts each query
 * and passes it down unawaited; each section awaits only what it draws. Two
 * sections needing the same query share one promise rather than issuing it
 * twice — which is what would have happened had each section called the
 * service itself, turning a streaming change into a slower page. It also keeps
 * the cross-feature composition (projects, alert rules) in the route, where
 * `PROJECT.md` §2.3 allows data loading, instead of pulling `features/projects`
 * and `features/alerts` into `features/overview` against §2.1.
 *
 * This reduces no database work at all. It changes when the first pixel
 * arrives, which on this page is the largest thing a person notices.
 */

interface OverviewPageProps {
    orgSlug: string;
    projects: OverviewProject[];
    range: string;
    environment: string;
    environmentsPromise: Promise<string[]>;
    statsPromise: Promise<Map<string, ProjectStats>>;
    /**
     * Passed down **unawaited** all the way to the per-project `Suspense`
     * boundaries in `OverviewProjectsPanel`. Awaiting it anywhere above them
     * would undo the split it exists for.
     */
    topMessagesPromise: Promise<Map<string, ProjectTopMessage>>;
    alertRulesPromise: Promise<Map<string, AlertRuleFlags[]>>;
    topErrorsPromise: Promise<TopMessage[]>;
    topErrorsWindow: TopErrorsWindow;
    levelBreakdownPromise: Promise<LevelCount[]>;
    bucketsPromise: Promise<EventBucket[]>;
}

/** The filter bar needs the environment list, which is now a registry lookup. */
async function FilterBarSection({
    range,
    environment,
    environmentsPromise,
}: Pick<OverviewPageProps, "range" | "environment" | "environmentsPromise">) {
    return (
        <DashboardFilterBar
            range={range}
            environment={environment}
            environments={await environmentsPromise}
        />
    );
}

export function OverviewPage({
    orgSlug,
    projects,
    range,
    environment,
    environmentsPromise,
    statsPromise,
    topMessagesPromise,
    alertRulesPromise,
    topErrorsPromise,
    topErrorsWindow,
    levelBreakdownPromise,
    bucketsPromise,
}: OverviewPageProps) {
    return (
        <div className={styles.page}>
            <Suspense fallback={<div className={styles.filterBarFallback} />}>
                <FilterBarSection
                    range={range}
                    environment={environment}
                    environmentsPromise={environmentsPromise}
                />
            </Suspense>

            <div className={styles.content}>
                <Suspense fallback={<CardSkeleton />}>
                    <OverviewKpiRow
                        projects={projects}
                        statsPromise={statsPromise}
                        alertRulesPromise={alertRulesPromise}
                        bucketsPromise={bucketsPromise}
                    />
                </Suspense>

                <Suspense fallback={<WidgetSkeleton />}>
                    <OverviewVolumeSection projects={projects} bucketsPromise={bucketsPromise} />
                </Suspense>

                <Suspense fallback={<WidgetSkeleton />}>
                    <OverviewProjectsPanel
                        projects={projects}
                        orgSlug={orgSlug}
                        statsPromise={statsPromise}
                        topMessagesPromise={topMessagesPromise}
                        alertRulesPromise={alertRulesPromise}
                    />
                </Suspense>

                <div className={styles.bottomRow}>
                    <Suspense fallback={<WidgetSkeleton />}>
                        <OverviewTopErrorsPanel
                            projects={projects}
                            topErrorsPromise={topErrorsPromise}
                            window={topErrorsWindow}
                        />
                    </Suspense>
                    <Suspense fallback={<WidgetSkeleton />}>
                        <OverviewLevelBreakdownPanel levelBreakdownPromise={levelBreakdownPromise} />
                    </Suspense>
                </div>
            </div>
        </div>
    );
}
