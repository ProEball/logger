"use client";

import { useState } from "react";
import { Button } from "@/shared/components";
import { ProjectDeleteDialog } from "../ProjectDeleteDialog/ProjectDeleteDialog";
import styles from "./ProjectDangerZone.module.scss";

interface ProjectDangerZoneProps {
    orgSlug: string;
    projectSlug: string;
    projectName: string;
}

export function ProjectDangerZone({ orgSlug, projectSlug, projectName }: ProjectDangerZoneProps) {
    const [showDelete, setShowDelete] = useState(false);

    return (
        <div className={styles.page}>
            <h1 className={styles.title}>Danger zone</h1>

            <div className={styles.dangerCard}>
                <div className={styles.row}>
                    <div className={styles.info}>
                        <strong className={styles.label}>Delete project</strong>
                        <p className={styles.desc}>
                            Permanently soft-deletes this project. All API keys will be revoked immediately.
                            Events are retained for 30 days.
                        </p>
                    </div>
                    <Button variant="danger" onClick={() => setShowDelete(true)}>
                        Delete project
                    </Button>
                </div>
            </div>

            <ProjectDeleteDialog
                open={showDelete}
                onClose={() => setShowDelete(false)}
                orgSlug={orgSlug}
                projectSlug={projectSlug}
                projectName={projectName}
            />
        </div>
    );
}
