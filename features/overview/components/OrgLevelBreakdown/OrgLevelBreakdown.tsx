import type { OrgLevelCount } from "@/features/overview/services/overview.service";
import styles from "./OrgLevelBreakdown.module.scss";

interface OrgLevelBreakdownProps {
    levels: OrgLevelCount[];
}

const LEVEL_ORDER = ["fatal", "error", "warn", "info", "debug"];

export function OrgLevelBreakdown({ levels }: OrgLevelBreakdownProps) {
    const ordered = LEVEL_ORDER
        .map((l) => levels.find((x) => x.level === l) ?? { level: l, count: 0 })
        .filter((l) => l.count > 0);

    const total = ordered.reduce((s, l) => s + l.count, 0);

    return (
        <div className={styles.card} role="group" aria-label="Level breakdown">
            <div className={styles.cardHead}>
                <span className={styles.cardTitle}>Level breakdown</span>
                {total > 0 && (
                    <span className={styles.totalBadge}>{total.toLocaleString()} total</span>
                )}
            </div>
            {ordered.length === 0 ? (
                <div className={styles.empty}>No events in this range</div>
            ) : (
                <ul className={styles.list}>
                    {ordered.map(({ level, count }) => {
                        const pct = total > 0 ? (count / total) * 100 : 0;
                        return (
                            <li key={level} className={styles.item}>
                                <div className={styles.itemLeft}>
                                    <span
                                        className={styles.dot}
                                        style={{ background: `var(--lvl-${level})` }}
                                    />
                                    <span className={styles.levelName}>{level}</span>
                                </div>
                                <div className={styles.barTrack}>
                                    <div
                                        className={styles.barFill}
                                        style={{
                                            width: `${pct}%`,
                                            background: `var(--lvl-${level})`,
                                        }}
                                    />
                                </div>
                                <span className={styles.count}>{count.toLocaleString()}</span>
                                <span className={styles.pct}>{pct.toFixed(1)}%</span>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}
