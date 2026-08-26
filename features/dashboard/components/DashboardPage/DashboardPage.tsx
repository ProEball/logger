import { Suspense } from "react";
import { DashboardFilterBar } from "@/shared/components/DashboardFilterBar/DashboardFilterBar";
import { WidgetSkeleton } from "@/shared/components";
import { KpiSection } from "./parts/KpiSection";
import {
    EventsChartSection,
    LevelBreakdownSection,
    RecentErrorsSection,
    TopMessagesSection,
    TopSourcesSection,
} from "./parts/WidgetSections";
import type { LevelledBucket } from "@/shared/utils/event-buckets";
import type {
    SourceCount,
} from "@/shared/services/event-aggregations.service";
import type { LevelCount, TopMessage } from "@/shared/services/event-aggregations.service";
import type { AlertRule } from "@/core/db/schema";
import type { Event } from "@/shared/types/event.types";
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
 * (`event-aggregations.service.bench.ts`, `PLAN.md` §16.2.)
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
    orgSlug: string;
    projectSlug: string;
    range: TimeRange;
    /** Validated preset, for the filter bar. */
    rangePreset: string;
    /** Selected environment; empty means all. */
    environment: string;
    /** Environments this project has used, for the filter pills. */
    environmentsPromise: Promise<string[]>;
    eventsPerMinPromise: Promise<LevelledBucket[]>;
    levelBreakdownPromise: Promise<LevelCount[]>;
    topMessagesPromise: Promise<TopMessage[]>;
    recentErrorsPromise: Promise<Event[]>;
    topSourcesPromise: Promise<SourceCount[]>;
    alertRulesPromise: Promise<AlertRule[]>;
}

/**
 * The filter bar: range, environment, auto-refresh, and nothing else.
 *
 * It briefly carried two slots. `DashboardHeader` was deleted on 2026-08-25 —
 * its four-preset control offered `1h/24h/7d/30d` where the organization
 * overview offered six, so a link between the dashboards could land on a range
 * the other could not display — and its title, live rate and "+ New alert" link
 * were moved into this bar's `leading` and `trailing` slots.
 *
 * Both slots are gone the same week, for the reason the header was: a control
 * that has to share a row loses. The name is unbounded and the pills are a
 * fixed-width run, so any real project name crowded them. The name and rate
 * moved up to the application top bar (`ProjectPulse`), which is sticky and
 * already answers "where am I". The "+ New alert" shortcut was removed outright
 * rather than moved: the alerts page carries the same button in its header and
 * again in its empty state, so it was a third copy of a link one click away.
 *
 * What is left is exactly what the overview renders, from the same component
 * with the same props — which was the point of sharing it.
 */
async function FilterBarSection({
    rangePreset,
    environment,
    environmentsPromise,
}: {
    rangePreset: string;
    environment: string;
    environmentsPromise: Promise<string[]>;
}) {
    return (
        <DashboardFilterBar
            range={rangePreset}
            environment={environment}
            environments={await environmentsPromise}
        />
    );
}

export function DashboardPage({
    orgSlug,
    projectSlug,
    range,
    rangePreset,
    environment,
    environmentsPromise,
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
            <Suspense fallback={<div className={styles.filterBarFallback} />}>
                <FilterBarSection
                    rangePreset={rangePreset}
                    environment={environment}
                    environmentsPromise={environmentsPromise}
                />
            </Suspense>

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

                {/* Row 3 — Recent errors span 8 + Top Sources span 4 */}
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
