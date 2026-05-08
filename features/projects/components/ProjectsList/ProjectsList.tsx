import Link from "next/link";
import { Button } from "@/shared/components";
import { ProjectCard } from "../ProjectCard/ProjectCard";
import type { Project } from "@/features/projects/services/projects.service";
import styles from "./ProjectsList.module.scss";

interface ProjectsListProps {
    projects: Project[];
    orgSlug: string;
    canCreate: boolean;
}

export function ProjectsList({ projects, orgSlug, canCreate }: ProjectsListProps) {
    if (projects.length === 0) {
        return (
            <div className={styles.empty}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={styles.emptyIcon}>
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
                <p className={styles.emptyHeading}>No projects yet</p>
                <p className={styles.emptyBody}>
                    Create a project to start ingesting events and generating API keys.
                </p>
                {canCreate && (
                    <Link href={`/${orgSlug}/projects/new`}>
                        <Button variant="primary">New project</Button>
                    </Link>
                )}
            </div>
        );
    }

    return (
        <div className={styles.grid}>
            {projects.map((project) => (
                <ProjectCard key={project.id} project={project} orgSlug={orgSlug} />
            ))}
        </div>
    );
}
