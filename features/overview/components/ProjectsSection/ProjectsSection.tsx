"use client";
import { useState } from "react";
import { ProjectCards } from "@/features/overview/components/ProjectCards/ProjectCards";
import { ProjectStatsTable } from "@/features/overview/components/ProjectStatsTable/ProjectStatsTable";
import type { ProjectRow } from "@/features/overview/services/overview.service";
import styles from "./ProjectsSection.module.scss";

interface ProjectsSectionProps {
    rows: ProjectRow[];
    orgSlug: string;
}

export function ProjectsSection({ rows, orgSlug }: ProjectsSectionProps) {
    const [view, setView] = useState<"cards" | "table">("cards");

    return (
        <div className={styles.section} role="group" aria-label="Projects">
            <div className={styles.sectionHead}>
                <div className={styles.headLeft}>
                    <span className={styles.sectionTitle}>Projects</span>
                    <span className={styles.count}>{rows.length}</span>
                </div>
                <div className={styles.toggle}>
                    <button
                        type="button"
                        className={`${styles.toggleBtn} ${view === "cards" ? styles.on : ""}`}
                        onClick={() => setView("cards")}
                    >
                        Cards
                    </button>
                    <button
                        type="button"
                        className={`${styles.toggleBtn} ${view === "table" ? styles.on : ""}`}
                        onClick={() => setView("table")}
                    >
                        Table
                    </button>
                </div>
            </div>

            {view === "cards" ? (
                <ProjectCards rows={rows} orgSlug={orgSlug} />
            ) : (
                <ProjectStatsTable rows={rows} orgSlug={orgSlug} />
            )}
        </div>
    );
}
