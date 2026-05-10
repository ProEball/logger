"use client";

import dynamic from "next/dynamic";
import { useSelector } from "react-redux";
import { selectAutoRefresh } from "@/core/store/slices/user";
import { useAutoRefresh } from "@/features/events/hooks/use-auto-refresh";
import { DashboardHeader } from "../DashboardHeader/DashboardHeader";
import { TopMessagesWidget } from "../widgets/TopMessagesWidget/TopMessagesWidget";
import { RecentErrorsWidget } from "../widgets/RecentErrorsWidget/RecentErrorsWidget";
import { WidgetSkeleton } from "@/shared/components";

// Recharts is ~150 kB — split into a separate chunk and hydrate after the
// static shell so it doesn't block the initial page render.
const EventsPerMinuteWidget = dynamic(
    () => import("../widgets/EventsPerMinuteWidget/EventsPerMinuteWidget")
        .then((m) => ({ default: m.EventsPerMinuteWidget })),
    { loading: () => <WidgetSkeleton /> },
);

const LevelBreakdownWidget = dynamic(
    () => import("../widgets/LevelBreakdownWidget/LevelBreakdownWidget")
        .then((m) => ({ default: m.LevelBreakdownWidget })),
    { loading: () => <WidgetSkeleton /> },
);

const EnvironmentBreakdownWidget = dynamic(
    () => import("../widgets/EnvironmentBreakdownWidget/EnvironmentBreakdownWidget")
        .then((m) => ({ default: m.EnvironmentBreakdownWidget })),
    { loading: () => <WidgetSkeleton /> },
);
import type { BucketRow, LevelCount, EnvCount, TopMessage } from "@/features/dashboard/services/aggregations.service";
import type { Event } from "@/core/db/schema";
import type { TimeRange } from "@/features/events/utils/event-filters.types";
import styles from "./DashboardPage.module.scss";

interface DashboardPageProps {
    projectName: string;
    orgSlug: string;
    projectSlug: string;
    range: TimeRange;
    eventsPerMin: BucketRow[];
    levelBreakdown: LevelCount[];
    envBreakdown: EnvCount[];
    topMessages: TopMessage[];
    recentErrors: Event[];
}

export function DashboardPage({
    projectName,
    orgSlug,
    projectSlug,
    range,
    eventsPerMin,
    levelBreakdown,
    envBreakdown,
    topMessages,
    recentErrors,
}: DashboardPageProps) {
    const autoRefresh = useSelector(selectAutoRefresh);
    useAutoRefresh(autoRefresh);

    const clickProps = { range, orgSlug, projectSlug };

    return (
        <div className={styles.page}>
            <DashboardHeader projectName={projectName} />

            <div className={styles.grid}>
                {/* Row 1: time-series spans full width */}
                <div className={styles.spanFull}>
                    <EventsPerMinuteWidget data={eventsPerMin} />
                </div>

                {/* Row 2: three equal columns */}
                <LevelBreakdownWidget
                    data={levelBreakdown}
                    {...clickProps}
                />
                <EnvironmentBreakdownWidget
                    data={envBreakdown}
                    {...clickProps}
                />
                <RecentErrorsWidget
                    data={recentErrors}
                    {...clickProps}
                />

                {/* Row 3: top messages spans full width */}
                <div className={styles.spanFull}>
                    <TopMessagesWidget
                        data={topMessages}
                        {...clickProps}
                    />
                </div>
            </div>
        </div>
    );
}
