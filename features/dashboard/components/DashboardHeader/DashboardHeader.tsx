"use client";

import { Suspense } from "react";
import Link from "next/link";
import { AutoRefreshControl } from "@/features/events/components/auto-refresh/AutoRefreshControl/AutoRefreshControl";
import { useDashboardRange } from "@/features/dashboard/hooks/use-dashboard-range";
import styles from "./DashboardHeader.module.scss";

const SEGMENT_PRESETS = ["1h", "24h", "7d", "30d"] as const;
type SegmentPreset = (typeof SEGMENT_PRESETS)[number];

interface DashboardHeaderProps {
    projectName: string;
    orgSlug: string;
    projectSlug: string;
    eventsPerMinRate?: string;
}

function DashboardHeaderInner({ projectName, orgSlug, projectSlug, eventsPerMinRate }: DashboardHeaderProps) {
    const { range, setRange } = useDashboardRange();
    const activePreset = range.type === "preset" ? range.value : null;

    const handlePreset = (preset: SegmentPreset) => {
        setRange({ type: "preset", value: preset });
    };

    return (
        <header className={styles.header}>
            <div className={styles.left}>
                <div className={styles.titleRow}>
                    <span className={styles.liveDot} aria-label="live" />
                    <h1 className={styles.title}>{projectName}</h1>
                </div>
                {eventsPerMinRate && (
                    <span className={styles.subtitle}>{eventsPerMinRate} events / min</span>
                )}
            </div>

            <div className={styles.controls}>
                <div className={styles.segment} role="group" aria-label="Time range">
                    {SEGMENT_PRESETS.map((preset) => (
                        <button
                            key={preset}
                            type="button"
                            className={activePreset === preset ? `${styles.segBtn} ${styles.segBtnActive}` : styles.segBtn}
                            onClick={() => handlePreset(preset)}
                        >
                            {preset}
                        </button>
                    ))}
                </div>

                <AutoRefreshControl />

                <Link
                    href={`/${orgSlug}/${projectSlug}/alerts/new`}
                    className={styles.newAlertBtn}
                >
                    + New alert
                </Link>
            </div>
        </header>
    );
}

export function DashboardHeader(props: DashboardHeaderProps) {
    return (
        <Suspense
            fallback={
                <header className={styles.header}>
                    <div className={styles.left}>
                        <div className={styles.titleRow}>
                            <span className={styles.liveDot} />
                            <h1 className={styles.title}>{props.projectName}</h1>
                        </div>
                    </div>
                    <div className={styles.controls}>
                        <div className={styles.segment}>
                            {SEGMENT_PRESETS.map((p) => (
                                <span key={p} className={styles.segBtn}>{p}</span>
                            ))}
                        </div>
                    </div>
                </header>
            }
        >
            <DashboardHeaderInner {...props} />
        </Suspense>
    );
}
