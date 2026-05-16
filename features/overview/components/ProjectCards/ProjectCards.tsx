import Link from "next/link";
import type { ProjectRow } from "@/features/overview/services/overview.service";
import styles from "./ProjectCards.module.scss";

interface ProjectCardsProps {
    rows: ProjectRow[];
    orgSlug: string;
}

function envClassName(env: string): string {
    const lower = env.toLowerCase();
    if (lower === "prod" || lower === "production") return styles.envProd;
    if (lower === "staging" || lower === "stage") return styles.envStaging;
    if (lower === "dev" || lower === "development" || lower === "local") return styles.envDev;
    return styles.envDefault;
}

export function ProjectCards({ rows, orgSlug }: ProjectCardsProps) {
    if (rows.length === 0) {
        return <div className={styles.empty}>No projects found</div>;
    }

    return (
        <div className={styles.grid}>
            {rows.map(({ project, totalEvents, errorCount, environments, topMessage, topMessageLevel, firingAlertsCount }) => {
                const isFiring = firingAlertsCount > 0;
                const errorRate = totalEvents > 0 ? (errorCount / totalEvents) * 100 : 0;
                const rateLabel = totalEvents === 0
                    ? "—"
                    : errorRate < 0.01 ? "<0.01%" : `${errorRate.toFixed(2)}%`;
                const rateClass = errorRate >= 5
                    ? styles.rateRed
                    : errorRate >= 1
                    ? styles.rateYellow
                    : styles.rateGreen;

                return (
                    <Link
                        key={project.id}
                        href={`/${orgSlug}/${project.slug}`}
                        className={`${styles.card} ${isFiring ? styles.firing : ""}`}
                    >
                        <div className={styles.cardTop}>
                            <div className={styles.projectName}>
                                <span className={styles.projectDot} />
                                {project.name}
                            </div>
                            {isFiring && (
                                <span className={styles.alertBadge}>
                                    <span className={styles.pulseDot} />
                                    {firingAlertsCount} firing
                                </span>
                            )}
                        </div>

                        {environments.length > 0 && (
                            <div className={styles.envRow}>
                                {environments.slice(0, 3).map((env) => (
                                    <span key={env} className={`${styles.envPill} ${envClassName(env)}`}>
                                        {env}
                                    </span>
                                ))}
                            </div>
                        )}

                        <div className={styles.statsRow}>
                            <div className={styles.stat}>
                                <span className={styles.statLabel}>Events</span>
                                <span className={styles.statValue}>{totalEvents.toLocaleString()}</span>
                            </div>
                            <div className={styles.stat}>
                                <span className={styles.statLabel}>Errors</span>
                                <span className={`${styles.statValue} ${errorCount > 0 ? styles.statValueError : ""}`}>
                                    {errorCount.toLocaleString()}
                                </span>
                            </div>
                            <div className={styles.stat}>
                                <span className={styles.statLabel}>Rate</span>
                                <span className={`${styles.statValue} ${rateClass}`}>
                                    {rateLabel}
                                </span>
                            </div>
                        </div>

                        {topMessage && (
                            <div className={styles.topError}>
                                {topMessageLevel && (
                                    <span
                                        className={styles.lvlDot}
                                        style={{ background: `var(--lvl-${topMessageLevel})` }}
                                    />
                                )}
                                <span className={styles.topErrorMsg} title={topMessage}>
                                    {topMessage.length > 58 ? topMessage.slice(0, 58) + "…" : topMessage}
                                </span>
                            </div>
                        )}
                    </Link>
                );
            })}
        </div>
    );
}
