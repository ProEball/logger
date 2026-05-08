import Link from "next/link";
import type { Project } from "@/features/projects/services/projects.service";
import styles from "./ProjectCard.module.scss";

interface ProjectCardProps {
    project: Project;
    orgSlug: string;
}

export function ProjectCard({ project, orgSlug }: ProjectCardProps) {
    const createdAt = new Date(project.createdAt);
    const relativeTime = formatRelative(createdAt);

    return (
        <Link href={`/${orgSlug}/${project.slug}`} className={styles.card}>
            <div className={styles.header}>
                <span className={styles.name}>{project.name}</span>
            </div>
            <div className={styles.slug}>{project.slug}</div>
            <div className={styles.meta}>
                <span className={styles.metaItem}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                    </svg>
                    —
                </span>
                <span className={styles.metaItem}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M21 2H3v16h5l4 4 4-4h5V2z" /><line x1="9" y1="9" x2="15" y2="9" /><line x1="9" y1="13" x2="12" y2="13" />
                    </svg>
                    —
                </span>
                <span className={styles.metaItem}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
                    </svg>
                    {relativeTime}
                </span>
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
