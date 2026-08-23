"use client";

import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { AutoRefreshControl } from "@/shared/components/AutoRefreshControl/AutoRefreshControl";
import { useDashboardRange } from "@/features/dashboard/hooks/use-dashboard-range";
import { DASHBOARD_SEGMENT_PRESETS } from "@/features/dashboard/utils/dashboard-range";
import type { TimeRangePreset } from "@/shared/utils/event-filters.schema";
import styles from "./DashboardHeader.module.scss";



interface DashboardHeaderProps {
    projectName: string;
    orgSlug: string;
    projectSlug: string;
    /**
     * A slot, not a string. The rate is derived from the bucket query, and this
     * header is a client component — so the value arrives as a Server Component
     * already wrapped in its own `Suspense`, and the title does not wait for a
     * 43 ms aggregation to render.
     */
    eventsPerMinRate?: ReactNode;
}

function DashboardHeaderInner({ projectName, orgSlug, projectSlug, eventsPerMinRate }: DashboardHeaderProps) {
    const { displayRange, isPending, setRange } = useDashboardRange();
    // The *displayed* range, not the committed one: a switch does not commit
    // until the new payload is ready, and on a 30-day range that is seventeen
    // seconds during which the clicked chip used to stay unstyled.
    const activePreset = displayRange.type === "preset" ? displayRange.value : null;

    const handlePreset = (preset: TimeRangePreset) => {
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
                    <span className={styles.subtitle}>{eventsPerMinRate}</span>
                )}
            </div>

            <div className={styles.controls}>
                <div
                    className={isPending ? `${styles.segment} ${styles.segmentPending}` : styles.segment}
                    role="group"
                    aria-label="Time range"
                    aria-busy={isPending}
                >
                    {DASHBOARD_SEGMENT_PRESETS.map((preset) => (
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
                            {DASHBOARD_SEGMENT_PRESETS.map((p) => (
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
