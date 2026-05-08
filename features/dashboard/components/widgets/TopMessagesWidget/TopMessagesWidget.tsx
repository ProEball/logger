"use client";

import { useRouter } from "next/navigation";
import { WidgetCard } from "../../WidgetCard/WidgetCard";
import { t } from "@/core/i18n/t";
import { serializeFilters } from "@/features/events/utils/serialize-filters";
import type { TopMessage } from "@/features/dashboard/services/aggregations.service";
import type { TimeRange } from "@/features/events/utils/event-filters.types";
import styles from "./TopMessagesWidget.module.scss";

interface TopMessagesWidgetProps {
    data: TopMessage[];
    range: TimeRange;
    orgSlug: string;
    projectSlug: string;
}

function formatRelative(date: Date): string {
    const diff = Date.now() - date.getTime();
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const mins = Math.floor(seconds / 60);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
}

export function TopMessagesWidget({
    data,
    range,
    orgSlug,
    projectSlug,
}: TopMessagesWidgetProps) {
    const router = useRouter();
    const isEmpty = data.length === 0;

    const handleClick = (message: string) => {
        const params = serializeFilters({ range, message });
        router.push(`/${orgSlug}/${projectSlug}/events?${params.toString()}`);
    };

    return (
        <WidgetCard title={t("dashboard.widgets.topMessages")} isEmpty={isEmpty}>
            <table className={styles.table}>
                <thead>
                    <tr>
                        <th className={styles.th}>{t("dashboard.table.count")}</th>
                        <th className={styles.th}>{t("dashboard.table.message")}</th>
                        <th className={`${styles.th} ${styles.right}`}>{t("dashboard.table.lastSeen")}</th>
                    </tr>
                </thead>
                <tbody>
                    {data.map((row, i) => (
                        <tr
                            key={i}
                            className={styles.row}
                            onClick={() => handleClick(row.message)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => e.key === "Enter" && handleClick(row.message)}
                        >
                            <td className={`${styles.td} ${styles.count}`}>
                                {row.count.toLocaleString()}
                            </td>
                            <td className={`${styles.td} ${styles.message}`}>
                                {row.message}
                            </td>
                            <td className={`${styles.td} ${styles.time} ${styles.right}`}>
                                {formatRelative(row.latestAt)}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </WidgetCard>
    );
}
