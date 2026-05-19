"use client";

import {
    ResponsiveContainer,
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
} from "recharts";
import type { OrgEventBucket } from "@/features/overview/services/overview.service";
import styles from "./OrgVolumeChart.module.scss";

const LINE_COLORS = [
    "#bd93f9",
    "#8be9fd",
    "#50fa7b",
    "#ffb86c",
    "#ff79c6",
    "#f1fa8c",
    "#ff5555",
];

interface Project {
    id: string;
    name: string;
}

interface OrgVolumeChartProps {
    buckets: OrgEventBucket[];
    projects: Project[];
}

function formatTick(value: unknown): string {
    const d = new Date(value as string);
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

interface TooltipPayloadItem {
    color: string;
    name: string;
    value: number;
}

interface CustomTooltipProps {
    active?: boolean;
    label?: string;
    payload?: TooltipPayloadItem[];
}

function CustomTooltip({ active, label, payload }: CustomTooltipProps) {
    if (!active || !payload?.length) return null;
    return (
        <div className={styles.tooltip}>
            <div className={styles.tooltipTime}>
                {new Date(label ?? "").toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
            </div>
            {payload.map((p) => (
                <div key={p.name} className={styles.tooltipRow}>
                    <span className={styles.tooltipDot} style={{ background: p.color }} />
                    <span className={styles.tooltipName}>{p.name}</span>
                    <span className={styles.tooltipValue}>{p.value.toFixed(1)}%</span>
                </div>
            ))}
        </div>
    );
}

type ChartPoint = Record<string, string | number>;

function buildChartData(buckets: OrgEventBucket[], projects: Project[]): ChartPoint[] {
    const tsSet = new Set(buckets.map((b) => b.ts.toISOString()));
    const timestamps = [...tsSet].sort();

    const dataMap = new Map<string, Map<string, { count: number; errorCount: number }>>();
    for (const b of buckets) {
        const key = b.ts.toISOString();
        if (!dataMap.has(key)) dataMap.set(key, new Map());
        dataMap.get(key)!.set(b.projectId, { count: b.count, errorCount: b.errorCount });
    }

    return timestamps.map((ts) => {
        const slot = dataMap.get(ts);
        const point: ChartPoint = { ts };
        for (const proj of projects) {
            const d = slot?.get(proj.id);
            const ratio = d && d.count > 0 ? (d.errorCount / d.count) * 100 : 0;
            point[proj.id] = parseFloat(ratio.toFixed(2));
        }
        return point;
    });
}

export function OrgVolumeChart({ buckets, projects }: OrgVolumeChartProps) {
    if (buckets.length === 0) {
        return (
            <div className={styles.card}>
                <div className={styles.cardHead}>
                    <span className={styles.cardTitle}>Error ratio</span>
                    <span className={styles.meta}>% errors + fatals</span>
                </div>
                <div className={styles.empty}>No events in this range</div>
            </div>
        );
    }

    const chartData = buildChartData(buckets, projects);

    return (
        <div className={styles.card}>
            <div className={styles.cardHead}>
                <span className={styles.cardTitle}>Error ratio</span>
                <span className={styles.meta}>% errors + fatals</span>
            </div>
            <div className={styles.chartWrap}>
                <ResponsiveContainer width="100%" height={100}>
                    <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                        <XAxis
                            dataKey="ts"
                            tickFormatter={formatTick}
                            tick={{ fontSize: 10, fill: "#6e6e85" }}
                            axisLine={false}
                            tickLine={false}
                            minTickGap={40}
                        />
                        <YAxis
                            tickFormatter={(v: number) => `${v}%`}
                            tick={{ fontSize: 10, fill: "#6e6e85" }}
                            axisLine={false}
                            tickLine={false}
                            width={36}
                            domain={[0, 100]}
                        />
                        <Tooltip content={<CustomTooltip />} />
                        {projects.map((proj, i) => (
                            <Line
                                key={proj.id}
                                type="monotone"
                                dataKey={proj.id}
                                name={proj.name}
                                stroke={LINE_COLORS[i % LINE_COLORS.length]}
                                strokeWidth={1.5}
                                dot={false}
                                isAnimationActive={false}
                            />
                        ))}
                    </LineChart>
                </ResponsiveContainer>
            </div>
            <div className={styles.legend}>
                {projects.map((proj, i) => (
                    <span key={proj.id} className={styles.legendItem}>
                        <span
                            className={styles.legendDot}
                            style={{ background: LINE_COLORS[i % LINE_COLORS.length] }}
                        />
                        {proj.name}
                    </span>
                ))}
            </div>
        </div>
    );
}
