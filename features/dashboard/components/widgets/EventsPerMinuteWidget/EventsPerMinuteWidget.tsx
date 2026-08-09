"use client";

import {
    ResponsiveContainer,
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
} from "recharts";
import { WidgetCard } from "../../WidgetCard/WidgetCard";
import { t } from "@/core/i18n/t";
import { KNOWN_LEVELS, levelColor } from "@/features/dashboard/utils/level-colors";
import type { BucketRow } from "@/features/dashboard/services/aggregations.service";
import styles from "./EventsPerMinuteWidget.module.scss";

interface EventsPerMinuteWidgetProps {
    data: BucketRow[];
}

const MAX_X_TICKS = 8;

// Bucket widths of 12h+ (the 7d/30d ranges) span multiple days, so the axis
// needs a date rather than a time-of-day to stay meaningful.
const DATE_TICK_THRESHOLD_MS = 12 * 60 * 60 * 1000;

function formatXTick(value: unknown, showDate: boolean): string {
    if (!(value instanceof Date) && typeof value !== "string" && typeof value !== "number") {
        return "";
    }
    const d = new Date(value as string | number | Date);
    return showDate
        ? d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
        : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
}

export function EventsPerMinuteWidget({ data }: EventsPerMinuteWidgetProps) {
    const isEmpty = data.every((row) => row.total === 0);

    // Flatten BucketRow[] into recharts-friendly array: { ts, debug, info, warn, error, fatal }
    const chartData = data.map((row) => ({
        ts: row.ts,
        ...Object.fromEntries(
            KNOWN_LEVELS.map((lvl) => [lvl, row.byLevel[lvl] ?? 0]),
        ),
    }));

    // Only render levels that appear in the data
    const activeLevels = KNOWN_LEVELS.filter((lvl) =>
        data.some((row) => (row.byLevel[lvl] ?? 0) > 0),
    );

    // Cap the number of x-axis labels regardless of bucket count, so dense
    // buckets (e.g. 60 one-minute points) don't crowd the axis illegibly.
    const tickInterval = Math.max(0, Math.ceil(chartData.length / MAX_X_TICKS) - 1);

    const bucketMs = chartData.length >= 2 ? chartData[1].ts.getTime() - chartData[0].ts.getTime() : 0;
    const showDateTicks = bucketMs >= DATE_TICK_THRESHOLD_MS;

    const legend = (
        <ul className={styles.legend}>
            {activeLevels.map((lvl) => (
                <li key={lvl} className={styles.legendItem}>
                    <span className={styles.dot} style={{ background: levelColor(lvl) }} />
                    {lvl}
                </li>
            ))}
        </ul>
    );

    return (
        <WidgetCard title={t("dashboard.widgets.eventsPerMinute")} isEmpty={isEmpty} actions={legend}>
            <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="2 4" stroke="#353746" />
                    <XAxis
                        dataKey="ts"
                        tickFormatter={(v) => formatXTick(v, showDateTicks)}
                        tick={{ fontSize: 10, fill: "#6272a4", fontFamily: "var(--font-mono)" }}
                        axisLine={false}
                        tickLine={false}
                        interval={tickInterval}
                    />
                    <YAxis
                        allowDecimals={false}
                        tick={{ fontSize: 10, fill: "#6272a4", fontFamily: "var(--font-mono)" }}
                        axisLine={false}
                        tickLine={false}
                        width={32}
                    />
                    <Tooltip
                        contentStyle={{
                            background: "#18181c",
                            border: "1px solid #2e2e37",
                            borderRadius: 6,
                            fontSize: 12,
                        }}
                        labelFormatter={(v) =>
                            new Date(v as string).toLocaleString(undefined, {
                                dateStyle: "short",
                                timeStyle: "medium",
                                hour12: false,
                            })
                        }
                    />
                    {activeLevels.map((lvl) => (
                        <Area
                            key={lvl}
                            type="monotone"
                            dataKey={lvl}
                            stackId="1"
                            stroke={levelColor(lvl)}
                            fill={levelColor(lvl)}
                            fillOpacity={0.25}
                            strokeWidth={1.5}
                            dot={false}
                            isAnimationActive={false}
                        />
                    ))}
                </AreaChart>
            </ResponsiveContainer>
        </WidgetCard>
    );
}
