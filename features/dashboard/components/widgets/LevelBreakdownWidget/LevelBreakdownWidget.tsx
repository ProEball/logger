"use client";

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { useRouter } from "next/navigation";
import { WidgetCard } from "../../WidgetCard/WidgetCard";
import { t } from "@/core/i18n/t";
import { levelColor } from "@/features/dashboard/utils/level-colors";
import { serializeFilters } from "@/features/events/utils/serialize-filters";
import type { LevelCount } from "@/features/dashboard/services/aggregations.service";
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
    const isEmpty = data.length === 0;
    const total = data.reduce((s, r) => s + r.count, 0);

    const handleClick = (level: string) => {
        const params = serializeFilters({ range, levels: [level as EventLevel] });
        router.push(`/${orgSlug}/${projectSlug}/events?${params.toString()}`);
    };

    const chartData = data.map((r) => ({
        name: r.level,
        value: r.count,
    }));

    return (
        <WidgetCard title={t("dashboard.widgets.levelBreakdown")} isEmpty={isEmpty}>
            <div className={styles.inner}>
                <ResponsiveContainer width="100%" height={160}>
                    <PieChart>
                        <Pie
                            data={chartData}
                            cx="50%"
                            cy="50%"
                            innerRadius={48}
                            outerRadius={72}
                            paddingAngle={2}
                            dataKey="value"
                            isAnimationActive={false}
                            cursor="pointer"
                            onClick={(entry) => handleClick(entry.name as string)}
                        >
                            {chartData.map((entry, index) => (
                                <Cell
                                    key={`${entry.name}-${index}`}
                                    fill={levelColor(entry.name)}
                                />
                            ))}
                        </Pie>
                        <Tooltip
                            contentStyle={{
                                background: "#18181c",
                                border: "1px solid #2e2e37",
                                borderRadius: 6,
                                fontSize: 12,
                            }}
                            formatter={(value) => {
                                const n = typeof value === "number" ? value : 0;
                                return [`${n.toLocaleString()} (${total > 0 ? Math.round((n / total) * 100) : 0}%)`];
                            }}
                        />
                    </PieChart>
                </ResponsiveContainer>

                <ul className={styles.legend}>
                    {data.map((row) => (
                        <li
                            key={row.level}
                            className={styles.legendItem}
                            onClick={() => handleClick(row.level)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => e.key === "Enter" && handleClick(row.level)}
                        >
                            <span
                                className={styles.dot}
                                style={{ background: levelColor(row.level) }}
                            />
                            <span className={styles.levelName}>{row.level}</span>
                            <span className={styles.levelCount}>{row.count.toLocaleString()}</span>
                        </li>
                    ))}
                </ul>
            </div>
        </WidgetCard>
    );
}
