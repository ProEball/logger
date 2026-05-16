import type { ReactNode } from "react";
import { cx } from "@/shared/utils/cx";
import styles from "./KpiCard.module.scss";

export type KpiDelta = "up" | "dn" | "flat";

export interface KpiCardProps {
    label: string;
    value: string | number;
    unit?: string;
    valueColor?: string;
    delta?: string;
    deltaDirection?: KpiDelta;
    footerLeft?: string;
    footerRight?: string;
    critical?: boolean;
    sparklineData?: number[];
    sparklineColor?: string;
    children?: ReactNode;
    className?: string;
}

function Sparkline({ data, colorVar }: { data: number[]; colorVar: string }) {
    if (data.length < 2) return null;
    const W = 80;
    const H = 32;
    const max = Math.max(...data, 1);
    const step = W / (data.length - 1);
    const pts = data.map((v, i) => `${(i * step).toFixed(1)},${(H - (v / max) * H).toFixed(1)}`);
    const linePoints = pts.join(" ");
    const fillPoints = `0,${H} ${linePoints} ${((data.length - 1) * step).toFixed(1)},${H}`;
    const gradId = `spk_${colorVar}`;

    return (
        <svg
            width={W}
            height={H}
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            aria-hidden="true"
            className={styles.sparkline}
        >
            <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" style={{ stopColor: `var(--${colorVar})`, stopOpacity: 0.4 }} />
                    <stop offset="100%" style={{ stopColor: `var(--${colorVar})`, stopOpacity: 0 }} />
                </linearGradient>
            </defs>
            <polygon points={fillPoints} fill={`url(#${gradId})`} />
            <polyline
                points={linePoints}
                fill="none"
                style={{ stroke: `var(--${colorVar})` }}
                strokeWidth="1.5"
                strokeLinejoin="round"
                strokeLinecap="round"
            />
        </svg>
    );
}

export function KpiCard({
    label,
    value,
    unit,
    valueColor,
    delta,
    deltaDirection = "flat",
    footerLeft,
    footerRight,
    critical,
    sparklineData,
    sparklineColor = "cyan",
    children,
    className,
}: KpiCardProps) {
    const hasSparkline = sparklineData && sparklineData.length >= 2;
    const hasFooter = footerLeft || footerRight;
    const arrowChar = deltaDirection === "up" ? "↑" : deltaDirection === "dn" ? "↓" : "—";

    return (
        <div className={cx(styles.card, critical && styles.critical, className)}>
            <div className={styles.topRow}>
                <span className={styles.label}>{label}</span>
                {hasSparkline && (
                    <Sparkline data={sparklineData} colorVar={sparklineColor} />
                )}
            </div>

            <div className={styles.valueRow}>
                <span
                    className={styles.value}
                    style={valueColor ? { color: `var(--${valueColor})` } : undefined}
                >
                    {value}
                </span>
                {unit && <span className={styles.unit}>{unit}</span>}
                {delta && (
                    <span className={cx(styles.delta, styles[`delta_${deltaDirection}`])}>
                        {arrowChar} {delta}
                    </span>
                )}
            </div>

            {hasFooter && (
                <div className={styles.footer}>
                    {footerLeft && <span className={styles.footerLeft}>{footerLeft}</span>}
                    {footerRight && <span className={styles.footerRight}>{footerRight}</span>}
                </div>
            )}

            {children}
        </div>
    );
}
