import Link from "next/link";
import type { ReactNode } from "react";
import type { ProjectRow } from "@/features/overview/services/overview.service";
import styles from "./ProjectStatsTable.module.scss";

interface ProjectStatsTableProps {
    rows: ProjectRow[];
    orgSlug: string;
    /** Per-project top-error cells, rendered on the server and streamed in. */
    topMessages: Record<string, ReactNode>;
}

function ErrorRate({ total, errors }: { total: number; errors: number }) {
    if (total === 0) return <span className={styles.rateDash}>—</span>;
    const rate = (errors / total) * 100;
    const label = rate < 0.01 ? "<0.01%" : `${rate.toFixed(2)}%`;
    if (rate >= 5) return <span className={styles.rateRed}>{label}</span>;
    if (rate >= 1) return <span className={styles.rateYellow}>{label}</span>;
    return <span className={styles.rateGreen}>{label}</span>;
}

function AlertBadge({ firingCount }: { firingCount: number }) {
    if (firingCount === 0) return <span className={styles.noAlert}>—</span>;
    return (
        <span className={styles.alertBadge}>
            <span className={styles.pulseDot} />
            {firingCount} firing
        </span>
    );
}

export function ProjectStatsTable({ rows, orgSlug, topMessages }: ProjectStatsTableProps) {
    return (
        <div className={styles.tableWrap}>
            <table className={styles.table}>
                <thead>
                    <tr>
                        <th className={styles.th}>Project</th>
                        <th className={styles.th} style={{ width: 110 }}>Events</th>
                        <th className={styles.th} style={{ width: 90 }}>Errors</th>
                        <th className={styles.th} style={{ width: 95 }}>Error rate</th>
                        <th className={styles.th}>Top error</th>
                        <th className={styles.th} style={{ width: 100 }}>Alerts</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map(({ project, totalEvents, errorCount, firingAlertsCount }) => (
                        <tr key={project.id} className={styles.row}>
                            <td className={styles.td}>
                                <Link
                                    href={`/${orgSlug}/${project.slug}`}
                                    className={styles.projectLink}
                                >
                                    <span className={styles.projectDot} />
                                    {project.name}
                                </Link>
                            </td>
                            <td className={styles.td}>
                                <span className={styles.mono}>
                                    {totalEvents.toLocaleString()}
                                </span>
                            </td>
                            <td className={styles.td}>
                                <span className={`${styles.mono} ${errorCount > 0 ? styles.errorCount : ""}`}>
                                    {errorCount.toLocaleString()}
                                </span>
                            </td>
                            <td className={styles.td}>
                                <ErrorRate total={totalEvents} errors={errorCount} />
                            </td>
                            <td className={styles.td}>{topMessages[project.id]}</td>
                            <td className={styles.td}>
                                <AlertBadge firingCount={firingAlertsCount} />
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
