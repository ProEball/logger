"use client";

import dynamic from "next/dynamic";
import { useSelector } from "react-redux";
import { selectAutoRefresh } from "@/core/store/slices/user";
import { useAutoRefresh } from "@/features/events/hooks/use-auto-refresh";
import { DashboardHeader } from "../DashboardHeader/DashboardHeader";
import { TopMessagesWidget } from "../widgets/TopMessagesWidget/TopMessagesWidget";
import { RecentErrorsWidget } from "../widgets/RecentErrorsWidget/RecentErrorsWidget";
import { TopSourcesWidget } from "../widgets/TopSourcesWidget/TopSourcesWidget";
import { LevelBreakdownWidget } from "../widgets/LevelBreakdownWidget/LevelBreakdownWidget";
import { KpiCard } from "../KpiCard/KpiCard";
import { WidgetSkeleton } from "@/shared/components";
import type { BucketRow, LevelCount, TopMessage, SourceCount } from "@/features/dashboard/services/aggregations.service";
import type { Event, AlertRule } from "@/core/db/schema";
import type { TimeRange, TimeRangePreset } from "@/features/events/utils/event-filters.types";
import styles from "./DashboardPage.module.scss";

const EventsPerMinuteWidget = dynamic(
    () => import("../widgets/EventsPerMinuteWidget/EventsPerMinuteWidget")
        .then((m) => ({ default: m.EventsPerMinuteWidget })),
    { loading: () => <WidgetSkeleton /> },
);

// ── KPI helpers ────────────────────────────────────────────────────────────────

const PRESET_MINUTES: Record<TimeRangePreset, number> = {
    "15m": 15, "1h": 60, "6h": 360, "24h": 1440, "7d": 10080, "30d": 43200,
};

function calcEventsPerMin(buckets: BucketRow[], range: TimeRange): string {
    const total = buckets.reduce((s, b) => s + b.total, 0);
    const minutes = range.type === "preset" ? (PRESET_MINUTES[range.value] ?? 60) : 60;
    const rate = total / minutes;
    return rate < 1 ? rate.toFixed(2) : Math.round(rate).toLocaleString();
}

function calcErrors(levels: LevelCount[]): string {
    const n = levels
        .filter((l) => l.level === "error" || l.level === "fatal")
        .reduce((s, l) => s + l.count, 0);
    return n.toLocaleString();
}

function calcFatal(levels: LevelCount[]): string {
    const n = levels.filter((l) => l.level === "fatal").reduce((s, l) => s + l.count, 0);
    return n.toLocaleString();
}

function calcFiring(rules: AlertRule[]): string {
    return rules.filter((r) => r.enabled && r.state === "firing").length.toString();
}

// ── Component ─────────────────────────────────────────────────────────────────

interface DashboardPageProps {
    projectName: string;
    orgSlug: string;
    projectSlug: string;
    range: TimeRange;
    eventsPerMin: BucketRow[];
    levelBreakdown: LevelCount[];
    topMessages: TopMessage[];
    recentErrors: Event[];
    topSrcs: SourceCount[];
    alertRules: AlertRule[];
}

export function DashboardPage({
    projectName,
    orgSlug,
    projectSlug,
    range,
    eventsPerMin,
    levelBreakdown,
    topMessages,
    recentErrors,
    topSrcs,
    alertRules,
}: DashboardPageProps) {
    const autoRefresh = useSelector(selectAutoRefresh);
    useAutoRefresh(autoRefresh);

    const clickProps = { range, orgSlug, projectSlug };

    const eventsPerMinRate = calcEventsPerMin(eventsPerMin, range);
    const errorsStr = calcErrors(levelBreakdown);
    const fatalStr = calcFatal(levelBreakdown);
    const firingCount = alertRules.filter((r) => r.enabled && r.state === "firing").length;

    // Sparkline series derived from time-bucketed data
    const totalSpark = eventsPerMin.map((b) => b.total);
    const errorSpark = eventsPerMin.map((b) => (b.byLevel.error ?? 0) + (b.byLevel.fatal ?? 0));
    const fatalSpark = eventsPerMin.map((b) => b.byLevel.fatal ?? 0);

    const firingRules = alertRules.filter((r) => r.enabled && r.state === "firing").slice(0, 3);

    return (
        <div className={styles.page}>
            <DashboardHeader
                projectName={projectName}
                orgSlug={orgSlug}
                projectSlug={projectSlug}
                eventsPerMinRate={eventsPerMinRate}
            />

            <div className={styles.grid}>
                {/* Row 1 — 4 KPI cards × span 3 */}
                <div className={styles.span3}>
                    <KpiCard
                        label="Events / min"
                        value={eventsPerMinRate}
                        unit="/ min"
                        sparklineData={totalSpark}
                        sparklineColor="cyan"
                        footerLeft={`over last ${range.type === "preset" ? range.value : "range"}`}
                    />
                </div>
                <div className={styles.span3}>
                    <KpiCard
                        label="Errors"
                        value={errorsStr}
                        sparklineData={errorSpark}
                        sparklineColor="red"
                        footerLeft="error + fatal"
                        critical={parseInt(errorsStr.replace(/,/g, ""), 10) > 0}
                    />
                </div>
                <div className={styles.span3}>
                    <KpiCard
                        label="Fatal"
                        value={fatalStr}
                        sparklineData={fatalSpark}
                        sparklineColor="pink"
                        footerLeft="fatal events"
                        critical={parseInt(fatalStr.replace(/,/g, ""), 10) > 0}
                    />
                </div>
                <div className={styles.span3}>
                    <KpiCard
                        label="Firing alerts"
                        value={calcFiring(alertRules)}
                        footerLeft={`of ${alertRules.length} rules total`}
                        critical={firingCount > 0}
                    >
                        {firingRules.length > 0 && (
                            <ul className={styles.firingList}>
                                {firingRules.map((r) => (
                                    <li key={r.id} className={styles.firingItem}>
                                        <span className={styles.firingDot} />
                                        <span className={styles.firingName}>{r.name}</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </KpiCard>
                </div>

                {/* Row 2 — Events chart span 8 + Level donut span 4 */}
                <div className={styles.span8}>
                    <EventsPerMinuteWidget data={eventsPerMin} />
                </div>
                <div className={styles.span4}>
                    <LevelBreakdownWidget data={levelBreakdown} {...clickProps} />
                </div>

                {/* Row 3 — Recent errors span 8 + Top hosts span 4 */}
                <div className={styles.span8}>
                    <RecentErrorsWidget data={recentErrors} {...clickProps} />
                </div>
                <div className={styles.span4}>
                    <TopSourcesWidget data={topSrcs} {...clickProps} />
                </div>

                {/* Row 4 — Top messages full width */}
                <div className={styles.span12}>
                    <TopMessagesWidget data={topMessages} {...clickProps} />
                </div>
            </div>
        </div>
    );
}
