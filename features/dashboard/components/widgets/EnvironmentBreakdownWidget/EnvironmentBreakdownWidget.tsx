"use client";

import {
    ResponsiveContainer,
    BarChart,
    Bar,
    XAxis,
    YAxis,
    Tooltip,
} from "recharts";
import { useRouter } from "next/navigation";
import { WidgetCard } from "../../WidgetCard/WidgetCard";
import { t } from "@/core/i18n/t";
import { serializeFilters } from "@/features/events/utils/serialize-filters";
import type { EnvCount } from "@/features/dashboard/services/aggregations.service";
import type { TimeRange } from "@/features/events/utils/event-filters.types";

interface EnvironmentBreakdownWidgetProps {
    data: EnvCount[];
    range: TimeRange;
    orgSlug: string;
    projectSlug: string;
}

export function EnvironmentBreakdownWidget({
    data,
    range,
    orgSlug,
    projectSlug,
}: EnvironmentBreakdownWidgetProps) {
    const router = useRouter();
    const isEmpty = data.length === 0;

    const handleClick = (env: string) => {
        if (env === "(unset)") return;
        const params = serializeFilters({ range, environments: [env] });
        router.push(`/${orgSlug}/${projectSlug}/events?${params.toString()}`);
    };

    const chartData = data.slice(0, 8).map((r) => ({
        name: r.environment,
        value: r.count,
    }));

    return (
        <WidgetCard title={t("dashboard.widgets.environmentBreakdown")} isEmpty={isEmpty}>
            <ResponsiveContainer width="100%" height={160}>
                <BarChart
                    data={chartData}
                    layout="vertical"
                    margin={{ top: 0, right: 16, bottom: 0, left: 8 }}
                >
                    <XAxis
                        type="number"
                        allowDecimals={false}
                        tick={{ fontSize: 11, fill: "#8e8ea0" }}
                        axisLine={false}
                        tickLine={false}
                    />
                    <YAxis
                        type="category"
                        dataKey="name"
                        width={72}
                        tick={{ fontSize: 11, fill: "#8e8ea0" }}
                        axisLine={false}
                        tickLine={false}
                    />
                    <Tooltip
                        cursor={{ fill: "rgba(99,102,241,0.08)" }}
                        contentStyle={{
                            background: "#18181c",
                            border: "1px solid #2e2e37",
                            borderRadius: 6,
                            fontSize: 12,
                        }}
                    />
                    <Bar
                        dataKey="value"
                        fill="#6366f1"
                        radius={[0, 3, 3, 0]}
                        isAnimationActive={false}
                        cursor="pointer"
                        onClick={(entry: { name?: string }) => {
                            if (entry.name) handleClick(entry.name);
                        }}
                    />
                </BarChart>
            </ResponsiveContainer>
        </WidgetCard>
    );
}
