import type { AlertRuleFlags, OverviewProject } from "@/features/overview/utils/build-project-rows";
import { buildProjectRows, sumProjectRows } from "@/features/overview/utils/build-project-rows";
import { totalsByTimestamp } from "@/features/overview/utils/bucket-totals";
import type { ProjectStats } from "@/shared/services/event-aggregations.service";
import type { EventBucket } from "@/shared/utils/event-buckets";
import { KpiSparkline } from "./parts/KpiSparkline";
import styles from "./OverviewKpiRow.module.scss";

interface OverviewKpiRowProps {
    projects: OverviewProject[];
    /**
     * Promises, not values. The route starts every query and hands the promises
     * down without awaiting, so each section suspends on only what it needs and
     * a slow aggregation cannot hold up the rest of the page.
     *
     * Two consumers awaiting the *same* promise share one query — which is why
     * this is passed as a promise rather than each section calling the service
     * itself. Doing that would have issued the bucket and summary queries twice.
     */
    /**
     * Statistics only. Until 2026-08-20 this was one promise that also carried
     * the per-project top message, so these four numbers — a few milliseconds
     * each under Postgres — waited ~954 ms for a message aggregation the row
     * does not render.
     */
    statsPromise: Promise<Map<string, ProjectStats>>;
    alertRulesPromise: Promise<Map<string, AlertRuleFlags[]>>;
    bucketsPromise: Promise<EventBucket[]>;
}

export async function OverviewKpiRow({
    projects,
    statsPromise,
    alertRulesPromise,
    bucketsPromise,
}: OverviewKpiRowProps) {
    const [stats, alertRules, buckets] = await Promise.all([
        statsPromise,
        alertRulesPromise,
        bucketsPromise,
    ]);

    const rows = buildProjectRows(projects, stats, alertRules);
    const { totalEvents, totalErrors, firingAlerts, enabledAlerts } = sumProjectRows(rows);
    const sparkData = totalsByTimestamp(buckets);

    return (
        <div className={styles.kpiRow}>
            <div className={styles.statCard} role="group" aria-label="Total events">
                <div className={styles.statLabel}>Total events</div>
                <div className={styles.statValue}>{totalEvents.toLocaleString()}</div>
                <div className={styles.statSub}>
                    {projects.length} project{projects.length !== 1 ? "s" : ""}
                </div>
                <KpiSparkline data={sparkData} color="var(--cyan)" />
            </div>

            <div
                className={`${styles.statCard} ${totalErrors > 0 ? styles.statCardCritical : ""}`}
                role="group"
                aria-label="Errors and fatals"
            >
                <div className={styles.statLabel}>Errors &amp; fatals</div>
                <div className={`${styles.statValue} ${totalErrors > 0 ? styles.valueRed : ""}`}>
                    {totalErrors.toLocaleString()}
                </div>
                <div className={styles.statSub}>across all projects</div>
                {sparkData.length >= 2 && <KpiSparkline data={sparkData} color="var(--lvl-error)" />}
            </div>

            <div
                className={`${styles.statCard} ${firingAlerts > 0 ? styles.statCardWarn : ""}`}
                role="group"
                aria-label="Firing alerts"
            >
                <div className={styles.statLabel}>Firing alerts</div>
                <div className={`${styles.statValue} ${firingAlerts > 0 ? styles.valueOrange : ""}`}>
                    {firingAlerts}
                </div>
                <div className={styles.statSub}>
                    {enabledAlerts} rule{enabledAlerts !== 1 ? "s" : ""} total
                </div>
            </div>

            <div className={styles.statCard} role="group" aria-label="Projects count">
                <div className={styles.statLabel}>Projects</div>
                <div className={styles.statValue}>{projects.length}</div>
                <div className={styles.statSub}>in this organization</div>
            </div>
        </div>
    );
}
