"use client";

import { useRouter } from "next/navigation";
import { WidgetCard } from "../../WidgetCard/WidgetCard";
import type { SourceCount } from "@/shared/services/event-aggregations.service";
import type { TimeRange } from "@/features/events/utils/event-filters.types";
import { serializeFilters } from "@/features/events/utils/serialize-filters";
import styles from "./TopSourcesWidget.module.scss";

interface TopSourcesWidgetProps {
    data: SourceCount[];
    range: TimeRange;
    orgSlug: string;
    projectSlug: string;
}

export function TopSourcesWidget({ data, range, orgSlug, projectSlug }: TopSourcesWidgetProps) {
    const router = useRouter();
    const isEmpty = data.length === 0;
    const total = data.reduce((s, r) => s + r.count, 0) || 1;
    const max = data[0]?.count ?? 1;

    const handleClick = (source: string) => {
        const sources = source === "(unknown)" ? undefined : [source];
        const params = serializeFilters({ range, sources });
        router.push(`/${orgSlug}/${projectSlug}/events?${params.toString()}`);
    };

    return (
        <WidgetCard title="Top Sources" isEmpty={isEmpty}>
            <ul className={styles.list}>
                {data.map((row, i) => {
                    const pct = Math.round((row.count / total) * 100);
                    const barPct = Math.round((row.count / max) * 100);
                    return (
                        <li
                            key={row.source}
                            className={styles.item}
                            onClick={() => handleClick(row.source)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => e.key === "Enter" && handleClick(row.source)}
                        >
                            <span className={styles.rank}>{String(i + 1).padStart(2, "0")}</span>
                            <span className={styles.host}>{row.source}</span>
                            <div className={styles.barWrap}>
                                <div
                                    className={styles.bar}
                                    style={{ width: `${barPct}%` }}
                                    aria-hidden="true"
                                />
                            </div>
                            <span className={styles.pct}>{pct}%</span>
                        </li>
                    );
                })}
            </ul>
        </WidgetCard>
    );
}
