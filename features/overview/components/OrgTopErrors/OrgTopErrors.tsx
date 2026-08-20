import type { OrgTopError } from "@/features/overview/services/overview.service";
import styles from "./OrgTopErrors.module.scss";

interface Project {
    id: string;
    name: string;
    slug: string;
}

interface OrgTopErrorsProps {
    errors: OrgTopError[];
    projects: Project[];
    /**
     * The window actually queried, e.g. "24h". Shown because it can differ from
     * the range selected above — this widget is capped, and a figure covering a
     * period other than the one the page advertises has to say so.
     */
    windowLabel: string;
    /** True when the page asked for a wider range than this widget allows. */
    isWindowClamped: boolean;
}

function timeAgo(date: Date): string {
    const secs = Math.floor((Date.now() - date.getTime()) / 1000);
    if (secs < 60) return `${secs}s ago`;
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
}

export function OrgTopErrors({ errors, projects, windowLabel, isWindowClamped }: OrgTopErrorsProps) {
    const projectMap = new Map(projects.map((p) => [p.id, p]));

    return (
        <div className={styles.card} role="group" aria-label="Top errors across org">
            <div className={styles.cardHead}>
                <span className={styles.cardTitle}>Top errors across org</span>
                <span
                    className={styles.windowBadge}
                    title={
                        isWindowClamped
                            ? "Capped at 24 hours — this widget reads raw events, so a wider window costs in proportion to the errors in it."
                            : undefined
                    }
                >
                    last {windowLabel}
                </span>
            </div>
            {errors.length === 0 ? (
                <div className={styles.empty}>No errors in the last {windowLabel}</div>
            ) : (
                <ul className={styles.list}>
                    {errors.map((err, i) => {
                        const project = projectMap.get(err.projectId);
                        return (
                            <li key={i} className={styles.item}>
                                <div className={styles.itemMain}>
                                    <div className={styles.msgRow}>
                                        <span
                                            className={styles.lvlDot}
                                            style={{ background: `var(--lvl-${err.dominantLevel})` }}
                                        />
                                        <span className={styles.msg} title={err.message}>
                                            {err.message.length > 72
                                                ? err.message.slice(0, 72) + "…"
                                                : err.message}
                                        </span>
                                    </div>
                                    <div className={styles.itemMeta}>
                                        {project && (
                                            <span className={styles.projectTag}>{project.name}</span>
                                        )}
                                        <span className={styles.timeAgo}>{timeAgo(err.latestAt)}</span>
                                    </div>
                                </div>
                                <span className={styles.count}>{err.count.toLocaleString()}</span>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}
