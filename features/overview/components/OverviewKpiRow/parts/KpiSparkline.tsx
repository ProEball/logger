import styles from "../OverviewKpiRow.module.scss";

function sparklinePath(data: number[], W: number, H: number): string {
    if (data.length < 2) return "";
    const max = Math.max(...data, 1);
    const step = W / (data.length - 1);
    return data
        .map((v, i) => {
            const x = (i * step).toFixed(1);
            const y = (H - (v / max) * H).toFixed(1);
            return i === 0 ? `M ${x},${y}` : `L ${x},${y}`;
        })
        .join(" ");
}

export function KpiSparkline({ data, color }: { data: number[]; color: string }) {
    if (data.length < 2) return null;
    const W = 56;
    const H = 22;
    return (
        <svg
            width={W}
            height={H}
            viewBox={`0 0 ${W} ${H}`}
            className={styles.sparkline}
            aria-hidden="true"
        >
            <path
                d={sparklinePath(data, W, H)}
                fill="none"
                stroke={color}
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity="0.6"
            />
        </svg>
    );
}
