"use client";

import { useSelector } from "react-redux";
import { selectAutoRefresh } from "@/core/store/slices/user";
import { useAutoRefresh } from "@/features/events/hooks/use-auto-refresh";
import { DashboardHeader } from "../DashboardHeader/DashboardHeader";
import { EventsPerMinuteWidget } from "../widgets/EventsPerMinuteWidget/EventsPerMinuteWidget";
import { LevelBreakdownWidget } from "../widgets/LevelBreakdownWidget/LevelBreakdownWidget";
import { EnvironmentBreakdownWidget } from "../widgets/EnvironmentBreakdownWidget/EnvironmentBreakdownWidget";
import { TopMessagesWidget } from "../widgets/TopMessagesWidget/TopMessagesWidget";
import { RecentErrorsWidget } from "../widgets/RecentErrorsWidget/RecentErrorsWidget";
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
