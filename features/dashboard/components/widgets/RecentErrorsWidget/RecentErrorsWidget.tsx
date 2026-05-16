"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { WidgetCard } from "../../WidgetCard/WidgetCard";
import { LevelBadge } from "@/shared/components";
import type { Event } from "@/core/db/schema";
import type { TimeRange } from "@/features/events/utils/event-filters.types";
import { serializeFilters } from "@/features/events/utils/serialize-filters";
import styles from "./RecentErrorsWidget.module.scss";

interface RecentErrorsWidgetProps {
    data: Event[];
    range: TimeRange;
    orgSlug: string;
    projectSlug: string;
}

function formatTime(date: Date): string {
    return new Date(date).toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    });
}

export function RecentErrorsWidget({
    data,
    range,
    orgSlug,
    projectSlug,
}: RecentErrorsWidgetProps) {
    const router = useRouter();
    const isEmpty = data.length === 0;
    const eventsBase = `/${orgSlug}/${projectSlug}/events`;

    const handleClick = (event: Event) => {
        const p = serializeFilters({ range });
        p.set("event", event.id);
        p.set("event_ts", new Date(event.timestamp).toISOString());
        router.push(`${eventsBase}?${p.toString()}`);
    };

    const viewAllHref = `${eventsBase}?${serializeFilters({ range, levels: ["error", "fatal"] }).toString()}`;

    const actions = (
        <Link href={viewAllHref} className={styles.viewAll}>
            View all →
        </Link>
    );

    return (
        <WidgetCard title="Recent errors" isEmpty={isEmpty} actions={actions}>
            <div className={styles.grid}>
                <div className={`${styles.th} ${styles.colTime}`}>Time</div>
                <div className={`${styles.th} ${styles.colLevel}`}>Level</div>
                <div className={`${styles.th} ${styles.colMsg}`}>Message</div>
                <div className={`${styles.th} ${styles.colSource}`}>Source</div>
                <div className={`${styles.th} ${styles.colEnv}`}>Env</div>

                {data.map((event) => (
                    <div
                        key={event.id}
                        className={styles.row}
                        onClick={() => handleClick(event)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => e.key === "Enter" && handleClick(event)}
                    >
                        <div className={`${styles.td} ${styles.colTime} ${styles.mono}`}>
                            {formatTime(event.timestamp)}
                        </div>
                        <div className={`${styles.td} ${styles.colLevel}`}>
                            <LevelBadge level={event.level as "error" | "fatal"} size="sm" />
                        </div>
                        <div className={`${styles.td} ${styles.colMsg} ${styles.monoTrunc}`}>
                            {event.message}
                        </div>
                        <div className={`${styles.td} ${styles.colSource} ${styles.cyanMono}`}>
                            {event.source ?? "—"}
                        </div>
                        <div className={`${styles.td} ${styles.colEnv} ${styles.dimMono}`}>
                            {event.environment ?? "—"}
                        </div>
                    </div>
                ))}
            </div>
        </WidgetCard>
    );
}
