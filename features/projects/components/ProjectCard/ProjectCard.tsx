import Link from "next/link";
import type { Project } from "@/features/projects/services/projects.service";
import styles from "./ProjectCard.module.scss";

type ProjectStatus = 'live' | 'degraded' | 'inactive';

interface ProjectCardProps {
    project: Project;
    orgSlug: string;
    status?: ProjectStatus;
    eventsPerMin?: number;
    errorCount?: number;
    createdRelative?: string;
}

export function ProjectCard({ project, orgSlug, status = 'inactive', eventsPerMin, errorCount }: ProjectCardProps) {
    const createdAt = new Date(project.createdAt);
    const relativeTime = formatRelative(createdAt);

    return (
        <Link href={`/${orgSlug}/${project.slug}`} className={styles.card}>
            <div className={styles.head}>
                <span className={`${styles.statusDot} ${styles[`statusDot_${status}`]}`} aria-hidden="true" />
                <span className={styles.name}>{project.name}</span>
                <span className={`${styles.statusBadge} ${styles[`statusBadge_${status}`]}`}>{status}</span>
            </div>

            <div className={styles.slug}>{project.slug}</div>

            <div className={styles.stats}>
                <div className={styles.stat}>
                    <span className={styles.statValue}>{eventsPerMin ?? '—'}</span>
                    <span className={styles.statLabel}>Events/min</span>
                </div>
                <div className={styles.stat}>
                    <span className={styles.statValue}>{errorCount ?? '—'}</span>
                    <span className={styles.statLabel}>Errors</span>
                </div>
                <div className={styles.stat}>
                    <span className={styles.statValue}>{relativeTime}</span>
                    <span className={styles.statLabel}>Created</span>
                </div>
            </div>
        </Link>
    );
}

function formatRelative(date: Date): string {
    const diff = Date.now() - date.getTime();
    const days = Math.floor(diff / 86400000);
    if (days === 0) return "today";
    if (days === 1) return "1d ago";
    if (days < 30) return `${days}d ago`;
    const months = Math.floor(days / 30);
    return `${months}mo ago`;
}
