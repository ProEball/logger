import { Suspense } from "react";
import { OverviewFilterBar } from "@/features/overview/components/OverviewFilterBar/OverviewFilterBar";
import { OrgVolumeChart } from "@/features/overview/components/OrgVolumeChart/OrgVolumeChart";
import { ProjectsSection } from "@/features/overview/components/ProjectsSection/ProjectsSection";
import { OrgTopErrors } from "@/features/overview/components/OrgTopErrors/OrgTopErrors";
import { OrgLevelBreakdown } from "@/features/overview/components/OrgLevelBreakdown/OrgLevelBreakdown";
import type {
    OrgTopError,
    OrgLevelCount,
    OrgEventBucket,
    ProjectRow,
} from "@/features/overview/services/overview.service";
import styles from "./OverviewPage.module.scss";

interface Project {
    id: string;
    slug: string;
    name: string;
}

interface OverviewPageProps {
    orgSlug: string;
    projects: Project[];
    range: string;
    levels: string[];
    environment: string;
    environments: string[];
    searchString: string;
    projectRows: ProjectRow[];
    topErrors: OrgTopError[];
    levelBreakdown: OrgLevelCount[];
    buckets: OrgEventBucket[];
}

function sparklinePath(data: number[], W: number, H: number): string {
    if (data.length < 2) return "";
    const max = Math.max(...data, 1);
    const step = W / (data.length - 1);
    return data
        .map((v, i) => {
            const x = (i * step).toFixed(1);
            const y = (H - (v / max) * H).toFixed(1);
            return i === 0 ? `M ${x},${y}` : `L ${x},${y}`;
        })
        .join(" ");
}

function KpiSparkline({ data, color }: { data: number[]; color: string }) {
    if (data.length < 2) return null;
    const W = 56;
    const H = 22;
    const d = sparklinePath(data, W, H);
    return (
        <svg
            width={W}
            height={H}
            viewBox={`0 0 ${W} ${H}`}
            className={styles.sparkline}
            aria-hidden="true"
        >
            <path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.6" />
        </svg>
    );
}

export function OverviewPage({
    orgSlug,
    projects,
    range,
    levels,
    environment,
    environments,
    searchString,
    projectRows,
    topErrors,
    levelBreakdown,
    buckets,
}: OverviewPageProps) {
    const totalEvents = projectRows.reduce((s, r) => s + r.totalEvents, 0);
    const totalErrors = projectRows.reduce((s, r) => s + r.errorCount, 0);
    const firingCount = projectRows.reduce((s, r) => s + r.firingAlertsCount, 0);

    // Aggregate bucket totals per timestamp for KPI sparklines
    const tsMap = new Map<string, number>();
    for (const b of buckets) {
        const key = b.ts.toISOString();
        tsMap.set(key, (tsMap.get(key) ?? 0) + b.count);
    }
    const sparkData = [...tsMap.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([, v]) => v);

    return (
        <div className={styles.page}>
            <Suspense>
                <OverviewFilterBar
                    range={range}
                    levels={levels}
                    environment={environment}
                    environments={environments}
                    searchString={searchString}
                />
            </Suspense>

            <div className={styles.content}>
                {/* KPI row */}
                <div className={styles.kpiRow}>
                    <div className={styles.statCard}>
                        <div className={styles.statLabel}>Total events</div>
                        <div className={styles.statValue}>{totalEvents.toLocaleString()}</div>
                        <div className={styles.statSub}>
                            {projects.length} project{projects.length !== 1 ? "s" : ""}
                        </div>
                        <KpiSparkline data={sparkData} color="var(--cyan)" />
                    </div>

                    <div className={`${styles.statCard} ${totalErrors > 0 ? styles.statCardCritical : ""}`}>
                        <div className={styles.statLabel}>Errors &amp; fatals</div>
                        <div className={`${styles.statValue} ${totalErrors > 0 ? styles.valueRed : ""}`}>
                            {totalErrors.toLocaleString()}
                        </div>
                        <div className={styles.statSub}>across all projects</div>
                        {sparkData.length >= 2 && <KpiSparkline data={sparkData} color="var(--lvl-error)" />}
                    </div>

                    <div className={`${styles.statCard} ${firingCount > 0 ? styles.statCardWarn : ""}`}>
                        <div className={styles.statLabel}>Firing alerts</div>
                        <div className={`${styles.statValue} ${firingCount > 0 ? styles.valueOrange : ""}`}>
                            {firingCount}
                        </div>
                        <div className={styles.statSub}>
                            {projectRows.reduce((s, r) => s + r.enabledAlertsCount, 0)} rule{projectRows.reduce((s, r) => s + r.enabledAlertsCount, 0) !== 1 ? "s" : ""} total
                        </div>
                    </div>

                    <div className={styles.statCard}>
                        <div className={styles.statLabel}>Projects</div>
                        <div className={styles.statValue}>{projects.length}</div>
                        <div className={styles.statSub}>in this organization</div>
                    </div>
                </div>

                {/* Volume chart */}
                <OrgVolumeChart buckets={buckets} projects={projects} />

                {/* Projects section (cards + table toggle) */}
                <ProjectsSection rows={projectRows} orgSlug={orgSlug} />

                {/* Bottom two-column row */}
                <div className={styles.bottomRow}>
                    <OrgTopErrors errors={topErrors} projects={projects} />
                    <OrgLevelBreakdown levels={levelBreakdown} />
                </div>
            </div>
        </div>
    );
}
