"use client";

import { Suspense } from "react";
import { TimeRangePicker } from "@/features/events/components/filters/TimeRangePicker/TimeRangePicker";
import { AutoRefreshControl } from "@/features/events/components/auto-refresh/AutoRefreshControl/AutoRefreshControl";
import { useDashboardRange, DASHBOARD_PRESETS } from "@/features/dashboard/hooks/use-dashboard-range";
import { t } from "@/core/i18n/t";
import styles from "./DashboardHeader.module.scss";

interface DashboardHeaderProps {
    projectName: string;
}

function DashboardHeaderInner({ projectName }: DashboardHeaderProps) {
    const { range, setRange } = useDashboardRange();

    return (
        <header className={styles.header}>
            <h1 className={styles.title}>{projectName}</h1>
            <div className={styles.controls}>
                <TimeRangePicker
                    value={range}
                    onChange={setRange}
                    presets={DASHBOARD_PRESETS}
                />
                <AutoRefreshControl />
            </div>
        </header>
    );
}

export function DashboardHeader({ projectName }: DashboardHeaderProps) {
    return (
        <Suspense fallback={
            <header className={styles.header}>
                <h1 className={styles.title}>{projectName}</h1>
                <div className={styles.controls}>
                    <span className={styles.placeholder}>{t("events.timeRange.1h")}</span>
                </div>
            </header>
        }>
            <DashboardHeaderInner projectName={projectName} />
        </Suspense>
    );
}
