"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { WidgetCard } from "../../WidgetCard/WidgetCard";
import { t } from "@/core/i18n/t";
import { levelColor } from "@/features/dashboard/utils/level-colors";
import { serializeFilters } from "@/features/events/utils/serialize-filters";
import type { LevelCount } from "@/shared/services/event-aggregations.service";
import type { TimeRange } from "@/features/events/utils/event-filters.types";
import type { EventLevel } from "@/features/ingest/utils/event-schema";
import styles from "./LevelBreakdownWidget.module.scss";

interface LevelBreakdownWidgetProps {
    data: LevelCount[];
    range: TimeRange;
    orgSlug: string;
    projectSlug: string;
}

export function LevelBreakdownWidget({
    data,
    range,
    orgSlug,
    projectSlug,
}: LevelBreakdownWidgetProps) {
    const router = useRouter();
    const [hovered, setHovered] = useState<string | null>(null);
    const isEmpty = data.length === 0;

    const total = data.reduce((s, r) => s + r.count, 0);
    const max = Math.max(1, ...data.map((r) => r.count));
    const rows = [...data].sort((a, b) => b.count - a.count);

    const handleClick = (level: string) => {
        const params = serializeFilters({ range, levels: [level as EventLevel] });
        router.push(`/${orgSlug}/${projectSlug}/events?${params.toString()}`);
    };

    const subtitle = `${total.toLocaleString()} events · last ${range.type === "preset" ? range.value : "range"}`;

    return (
        <WidgetCard
            title={t("dashboard.widgets.levelBreakdown")}
            isEmpty={isEmpty}
            actions={<span className={styles.subtitle}>{subtitle}</span>}
        >
            <div className={styles.list}>
                {rows.map(({ level, count }) => {
                    const pct = total > 0 ? (count / total) * 100 : 0;
                    const dimmed = hovered !== null && hovered !== level;

                    return (
                        <div
                            key={level}
                            className={styles.col}
                            onClick={() => handleClick(level)}
                            onMouseEnter={() => setHovered(level)}
                            onMouseLeave={() => setHovered(null)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => e.key === "Enter" && handleClick(level)}
                        >
                            <span className={styles.count}>{count.toLocaleString()}</span>
                            <span className={styles.track}>
                                <span
                                    className={styles.fill}
                                    style={{
                                        height: `${(count / max) * 100}%`,
                                        background: levelColor(level),
                                        opacity: dimmed ? 0.35 : 1,
                                    }}
                                />
                            </span>
                            <span className={styles.name}>{level}</span>
                            <span className={styles.pct}>
                                {pct > 0 && pct < 0.1 ? "< 0.1%" : `${pct.toFixed(1)}%`}
                            </span>
                        </div>
                    );
                })}
            </div>
        </WidgetCard>
    );
}
