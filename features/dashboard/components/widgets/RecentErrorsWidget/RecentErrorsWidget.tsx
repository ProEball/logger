"use client";

import { useRouter } from "next/navigation";
import { WidgetCard } from "../../WidgetCard/WidgetCard";
import { LevelBadge } from "@/shared/components";
import { t } from "@/core/i18n/t";
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

    const handleClick = (event: Event) => {
        const base = `/${orgSlug}/${projectSlug}/events`;
        const rangeParams = serializeFilters({ range });
        rangeParams.set("event", event.id);
        rangeParams.set("event_ts", new Date(event.timestamp).toISOString());
        router.push(`${base}?${rangeParams.toString()}`);
    };

    return (
        <WidgetCard title={t("dashboard.widgets.recentErrors")} isEmpty={isEmpty}>
            <ul className={styles.list}>
                {data.map((event) => (
                    <li
                        key={event.id}
                        className={styles.item}
                        onClick={() => handleClick(event)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => e.key === "Enter" && handleClick(event)}
                    >
                        <div className={styles.itemTop}>
                            <LevelBadge level={event.level as "error" | "fatal"} size="sm" />
                            <span className={styles.time}>{formatTime(event.timestamp)}</span>
                        </div>
                        <p className={styles.message}>{event.message}</p>
                        {event.errorType && (
                            <span className={styles.errorType}>{event.errorType}</span>
                        )}
                    </li>
                ))}
            </ul>
        </WidgetCard>
    );
}
