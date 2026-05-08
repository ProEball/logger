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

interface EventsPerMinuteWidgetProps {
    data: BucketRow[];
}

function formatXTick(value: unknown): string {
    if (!(value instanceof Date) && typeof value !== "string" && typeof value !== "number") {
        return "";
    }
    const d = new Date(value as string | number | Date);
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function EventsPerMinuteWidget({ data }: EventsPerMinuteWidgetProps) {
    const isEmpty = data.length === 0;

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

    return (
        <WidgetCard title={t("dashboard.widgets.eventsPerMinute")} isEmpty={isEmpty}>
            <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis
                        dataKey="ts"
                        tickFormatter={formatXTick}
                        tick={{ fontSize: 11, fill: "#8e8ea0" }}
                        axisLine={false}
                        tickLine={false}
                    />
                    <YAxis
                        allowDecimals={false}
                        tick={{ fontSize: 11, fill: "#8e8ea0" }}
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
                        labelFormatter={(v) => new Date(v as string).toLocaleString()}
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
