import type { OrgEventBucket } from "@/features/overview/services/overview.service";
import styles from "./OrgVolumeChart.module.scss";

const CHART_COLORS = [
    "#3d8a5a",
    "#5a9bb0",
    "#8576b8",
    "#b88758",
    "#a85858",
    "#6b9a8a",
    "#7a7ab8",
    "#a87a3d",
];

interface Project {
    id: string;
    name: string;
}

interface OrgVolumeChartProps {
    buckets: OrgEventBucket[];
    projects: Project[];
}

export function OrgVolumeChart({ buckets, projects }: OrgVolumeChartProps) {
    if (buckets.length === 0) {
        return (
            <div className={styles.card}>
                <div className={styles.cardHead}>
                    <span className={styles.cardTitle}>Event volume</span>
                </div>
                <div className={styles.empty}>No events in this range</div>
            </div>
        );
    }

    const tsSet = new Set(buckets.map((b) => b.ts.toISOString()));
    const timestamps = [...tsSet].sort();

    const dataMap = new Map<string, Map<string, number>>();
    for (const b of buckets) {
        const key = b.ts.toISOString();
        if (!dataMap.has(key)) dataMap.set(key, new Map());
        dataMap.get(key)!.set(b.projectId, b.count);
    }

    const maxTotal = Math.max(
        ...timestamps.map((ts) => {
            const slot = dataMap.get(ts);
            if (!slot) return 0;
            return [...slot.values()].reduce((s, v) => s + v, 0);
        }),
        1,
    );

    const W = 800;
    const H = 72;
    const n = timestamps.length;
    const step = n > 0 ? W / n : W;
    const barW = Math.max(2, step * 0.82);
    const barOffset = (step - barW) / 2;

    const bars: React.ReactElement[] = [];
    timestamps.forEach((ts, i) => {
        const slot = dataMap.get(ts) ?? new Map<string, number>();
        let currentY = H;
        const x = i * step + barOffset;

        projects.forEach((proj, pi) => {
            const count = slot.get(proj.id) ?? 0;
            if (count === 0) return;
            const barH = (count / maxTotal) * H;
            currentY -= barH;
            bars.push(
                <rect
                    key={`${ts}-${proj.id}`}
                    x={x.toFixed(2)}
                    y={currentY.toFixed(2)}
                    width={barW.toFixed(2)}
                    height={barH.toFixed(2)}
                    fill={CHART_COLORS[pi % CHART_COLORS.length]}
                    opacity="0.78"
                />,
            );
        });
    });

    return (
        <div className={styles.card}>
            <div className={styles.cardHead}>
                <span className={styles.cardTitle}>Event volume</span>
                <span className={styles.meta}>{timestamps.length} buckets</span>
            </div>
            <div className={styles.chartWrap}>
                <svg
                    viewBox={`0 0 ${W} ${H}`}
                    className={styles.chart}
                    preserveAspectRatio="none"
                    aria-hidden="true"
                >
                    {[0.25, 0.5, 0.75].map((f) => (
                        <line
                            key={f}
                            x1={0}
                            y1={(H * (1 - f)).toFixed(2)}
                            x2={W}
                            y2={(H * (1 - f)).toFixed(2)}
                            stroke="var(--border-1)"
                            strokeDasharray="3 4"
                            strokeWidth="1"
                        />
                    ))}
                    {bars}
                </svg>
            </div>
            <div className={styles.legend}>
                {projects.map((proj, i) => (
                    <span key={proj.id} className={styles.legendItem}>
                        <span
                            className={styles.legendDot}
                            style={{ background: CHART_COLORS[i % CHART_COLORS.length] }}
                        />
                        {proj.name}
                    </span>
                ))}
            </div>
        </div>
    );
}
