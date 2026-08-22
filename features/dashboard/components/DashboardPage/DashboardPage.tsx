import { Suspense } from "react";
import { DashboardHeader } from "../DashboardHeader/DashboardHeader";
import { WidgetSkeleton } from "@/shared/components";
import { KpiSection } from "./parts/KpiSection";
import {
    EventsChartSection,
    HeaderRateSection,
    LevelBreakdownSection,
    RecentErrorsSection,
    TopMessagesSection,
    TopSourcesSection,
} from "./parts/WidgetSections";
import type { BucketRow } from "@/features/dashboard/utils/aggregation-utils";
import type {
    LevelCount,
    SourceCount,
    TopMessage,
} from "@/features/dashboard/services/aggregations.service";
import type { Event, AlertRule } from "@/core/db/schema";
import type { TimeRange } from "@/shared/utils/event-filters.schema";
import styles from "./DashboardPage.module.scss";

/**
 * The project dashboard.
 *
 * **A Server Component since 2026-08-21.** It used to be a client component
 * taking six resolved arrays, which meant the route awaited a single
 * `Promise.all` and nothing appeared until the slowest query returned. Measured,
 * that was `topMessages` at 170 ms against 43, 11.6, 11.2 and 0.84 for
 * everything else — so five widgets and the whole KPI row waited on one.
 * (`aggregations.service.bench.ts`, `PLAN.md` §16.2.)
 *
 * Each section now awaits its own promise behind its own `Suspense` boundary,
 * the same shape the org overview took in §16.1 Stage D. The route creates the
 * promises and passes them down unawaited; anything that awaits one above a
 * boundary undoes the split.
 *
 * The conversion also removed a defect rather than only restructuring:
 * this component used to call `useAutoRefresh()` **and** render
 * `DashboardHeader`, which renders `AutoRefreshControl`, which calls
 * `useAutoRefresh()` too. Two intervals, two `router.refresh()` per tick — the
 * dashboard reloaded itself twice as often as the setting said, doubling its
 * own database load on the page this workstream exists to make cheaper. A
 * Server Component cannot hold a hook, so the duplicate could not survive the
 * move.
 */
interface DashboardPageProps {
    projectName: string;
    orgSlug: string;
    projectSlug: string;
    range: TimeRange;
    eventsPerMinPromise: Promise<BucketRow[]>;
    levelBreakdownPromise: Promise<LevelCount[]>;
    topMessagesPromise: Promise<TopMessage[]>;
    recentErrorsPromise: Promise<Event[]>;
    topSourcesPromise: Promise<SourceCount[]>;
    alertRulesPromise: Promise<AlertRule[]>;
}

export function DashboardPage({
    projectName,
    orgSlug,
    projectSlug,
    range,
    eventsPerMinPromise,
    levelBreakdownPromise,
    topMessagesPromise,
    recentErrorsPromise,
    topSourcesPromise,
    alertRulesPromise,
}: DashboardPageProps) {
    const clickProps = { range, orgSlug, projectSlug };

    return (
        <div className={styles.page}>
            <DashboardHeader
                projectName={projectName}
                orgSlug={orgSlug}
                projectSlug={projectSlug}
                eventsPerMinRate={
                    // A slot, not a string: the rate comes from the bucket
                    // query, and awaiting it here would put the page title
                    // behind a 43 ms aggregation. `null` while it loads —
                    // a skeleton in a header subtitle is more distracting than
                    // a line that appears.
                    <Suspense fallback={null}>
                        <HeaderRateSection promise={eventsPerMinPromise} range={range} />
                    </Suspense>
                }
            />

            <div className={styles.grid}>
                {/* Row 1 — 4 KPI cards × span 3 */}
                <Suspense fallback={<KpiRowSkeleton />}>
                    <KpiSection
                        range={range}
                        eventsPerMinPromise={eventsPerMinPromise}
                        levelBreakdownPromise={levelBreakdownPromise}
                        alertRulesPromise={alertRulesPromise}
                    />
                </Suspense>

                {/* Row 2 — Events chart span 8 + Level breakdown span 4 */}
                <div className={styles.span8}>
                    <Suspense fallback={<WidgetSkeleton />}>
                        <EventsChartSection promise={eventsPerMinPromise} />
                    </Suspense>
                </div>
                <div className={styles.span4}>
                    <Suspense fallback={<WidgetSkeleton />}>
                        <LevelBreakdownSection promise={levelBreakdownPromise} {...clickProps} />
                    </Suspense>
                </div>

                {/* Row 3 — Recent errors span 8 + Top hosts span 4 */}
                <div className={styles.span8}>
                    <Suspense fallback={<WidgetSkeleton />}>
                        <RecentErrorsSection promise={recentErrorsPromise} {...clickProps} />
                    </Suspense>
                </div>
                <div className={styles.span4}>
                    <Suspense fallback={<WidgetSkeleton />}>
                        <TopSourcesSection promise={topSourcesPromise} {...clickProps} />
                    </Suspense>
                </div>

                {/* Row 4 — Top messages full width. The 170 ms one. */}
                <div className={styles.span12}>
                    <Suspense fallback={<WidgetSkeleton />}>
                        <TopMessagesSection promise={topMessagesPromise} {...clickProps} />
                    </Suspense>
                </div>
            </div>
        </div>
    );
}

/** Four card-shaped placeholders, so row 1 does not collapse while it loads. */
function KpiRowSkeleton() {
    return (
        <>
            {[0, 1, 2, 3].map((i) => (
                <div key={i} className={styles.span3}>
                    <WidgetSkeleton />
                </div>
            ))}
        </>
    );
}
