"use client";

import {
    Area,
    AreaChart,
    CartesianGrid,
    Line,
    LineChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";
import styles from "./EventChart.module.scss";

/**
 * The chart both dashboards draw.
 *
 * The organization overview plots an **error ratio**, one line per project; the
 * project dashboard plots **volume**, one stacked area per level. Until
 * 2026-08-25 those were two components, `OrgVolumeChart` and
 * `EventsPerMinuteWidget`, with two copies of the axis formatting, the tick
 * thinning and the tooltip.
 *
 * ## Why it takes shaped data rather than buckets
 *
 * Both callers are Server Components and this is a client component, so
 * everything crossing the boundary must be serialisable — which rules out the
 * obvious design of passing buckets plus an accessor function. Instead each page
 * shapes its own points and declares its series, and this draws them.
 *
 * That is not a workaround, it is the better split: the shaping is arithmetic
 * over query results and now sits in pure functions with tests
 * (`errorRatioPoints`, `levelPoints`), where it was previously buried inside two
 * client components and unreachable by any test at all.
 */

/** One line or area, and how to label and colour it. */
export interface ChartSeries {
    /** The key its value is stored under in each point. */
    key: string;
    label: string;
    /** A CSS colour — a `var(--…)` token or a literal. */
    color: string;
}

/** One x-position: a timestamp plus one number per series key. */
export type ChartPoint = { ts: string } & Record<string, string | number>;

interface EventChartProps {
    title: string;
    /** Small text beside the title — what the numbers mean. */
    meta?: string;
    points: ChartPoint[];
    series: ChartSeries[];
    /**
     * `stacked-area` for parts of a whole (levels making up a volume),
     * `line` for independent quantities (each project's error ratio).
     */
    mode: "stacked-area" | "line";
    /** Appended to y-axis ticks and tooltip values. */
    unit?: string;
    /** Shown in place of the chart when every point is zero. */
    emptyLabel: string;
    height?: number;
}

const MAX_X_TICKS = 8;

/**
 * Bucket widths of 12h and up span several days, so a time-of-day tick would
 * repeat and mean nothing. Measured from the data rather than passed in: the
 * chart already knows its own spacing.
 */
const DATE_TICK_THRESHOLD_MS = 12 * 60 * 60 * 1000;

function formatTick(value: unknown, showDate: boolean): string {
    const d = new Date(value as string);
    if (Number.isNaN(d.getTime())) return "";
    return showDate
        ? d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
        : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
}

interface TooltipPayloadItem {
    color: string;
    name: string;
    value: number;
}

function ChartTooltip({
    active,
    label,
    payload,
    unit,
    showDate,
}: {
    active?: boolean;
    label?: string;
    payload?: TooltipPayloadItem[];
    unit: string;
    showDate: boolean;
}) {
    if (!active || !payload?.length) return null;
    return (
        <div className={styles.tooltip}>
            <div className={styles.tooltipTime}>{formatTick(label, showDate)}</div>
            {payload.map((p) => (
                <div key={p.name} className={styles.tooltipRow}>
                    <span className={styles.tooltipDot} style={{ background: p.color }} />
                    <span className={styles.tooltipName}>{p.name}</span>
                    <span className={styles.tooltipValue}>
                        {unit === "%" ? p.value.toFixed(1) : p.value.toLocaleString()}
                        {unit}
                    </span>
                </div>
            ))}
        </div>
    );
}

export function EventChart({
    title,
    meta,
    points,
    series,
    mode,
    unit = "",
    emptyLabel,
    height = 200,
}: EventChartProps) {
    const isEmpty =
        points.length === 0 ||
        points.every((p) => series.every((s) => Number(p[s.key] ?? 0) === 0));

    // Cap the label count regardless of how many buckets there are, so a dense
    // series — sixty one-minute points — does not crowd the axis illegibly.
    const tickInterval = Math.max(0, Math.ceil(points.length / MAX_X_TICKS) - 1);

    const spacingMs =
        points.length >= 2
            ? new Date(points[1].ts).getTime() - new Date(points[0].ts).getTime()
            : 0;
    const showDate = spacingMs >= DATE_TICK_THRESHOLD_MS;

    const legend = (
        <ul className={styles.legend}>
            {series.map((s) => (
                <li key={s.key} className={styles.legendItem}>
                    <span className={styles.dot} style={{ background: s.color }} />
                    {s.label}
                </li>
            ))}
        </ul>
    );

    return (
        <div className={styles.card}>
            <div className={styles.cardHead}>
                <span className={styles.cardTitle}>{title}</span>
                {meta && <span className={styles.meta}>{meta}</span>}
                {!isEmpty && legend}
            </div>

            {isEmpty ? (
                <div className={styles.empty}>{emptyLabel}</div>
            ) : (
                <div className={styles.chartWrap}>
                    <ResponsiveContainer width="100%" height={height}>
                        {mode === "stacked-area" ? (
                            <AreaChart data={points} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                                <XAxis
                                    dataKey="ts"
                                    tickFormatter={(v: unknown) => formatTick(v, showDate)}
                                    tick={{ fontSize: 10, fill: "var(--fg-3)" }}
                                    axisLine={false}
                                    tickLine={false}
                                    interval={tickInterval}
                                />
                                <YAxis
                                    tick={{ fontSize: 10, fill: "var(--fg-3)" }}
                                    axisLine={false}
                                    tickLine={false}
                                    width={36}
                                />
                                <Tooltip
                                    content={<ChartTooltip unit={unit} showDate={showDate} />}
                                />
                                {series.map((s) => (
                                    <Area
                                        key={s.key}
                                        type="monotone"
                                        dataKey={s.key}
                                        name={s.label}
                                        stackId="1"
                                        stroke={s.color}
                                        fill={s.color}
                                        fillOpacity={0.25}
                                    />
                                ))}
                            </AreaChart>
                        ) : (
                            <LineChart data={points} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                                <XAxis
                                    dataKey="ts"
                                    tickFormatter={(v: unknown) => formatTick(v, showDate)}
                                    tick={{ fontSize: 10, fill: "var(--fg-3)" }}
                                    axisLine={false}
                                    tickLine={false}
                                    interval={tickInterval}
                                />
                                <YAxis
                                    tickFormatter={(v: number) => `${v}${unit}`}
                                    tick={{ fontSize: 10, fill: "var(--fg-3)" }}
                                    axisLine={false}
                                    tickLine={false}
                                    width={36}
                                />
                                <Tooltip
                                    content={<ChartTooltip unit={unit} showDate={showDate} />}
                                />
                                {series.map((s) => (
                                    <Line
                                        key={s.key}
                                        type="monotone"
                                        dataKey={s.key}
                                        name={s.label}
                                        stroke={s.color}
                                        strokeWidth={1.5}
                                        dot={false}
                                    />
                                ))}
                            </LineChart>
                        )}
                    </ResponsiveContainer>
                </div>
            )}
        </div>
    );
}
