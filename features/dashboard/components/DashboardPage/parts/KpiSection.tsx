import { KpiCard } from "@/features/dashboard/components/KpiCard/KpiCard";
import {
    errorCount,
    eventsPerMinuteRate,
    fatalCount,
    firingRules,
    sparklines,
} from "@/features/dashboard/utils/dashboard-kpis";
import type { BucketRow } from "@/features/dashboard/utils/aggregation-utils";
import type { LevelCount } from "@/features/dashboard/services/aggregations.service";
import type { AlertRule } from "@/core/db/schema";
import type { TimeRange } from "@/shared/utils/event-filters.schema";
import styles from "../DashboardPage.module.scss";

interface KpiSectionProps {
    range: TimeRange;
    eventsPerMinPromise: Promise<BucketRow[]>;
    levelBreakdownPromise: Promise<LevelCount[]>;
    alertRulesPromise: Promise<AlertRule[]>;
}

/**
 * The four KPI cards.
 *
 * Awaits three promises, which is why it is one boundary rather than four: the
 * cards share inputs — the sparklines and the rate both come from the bucket
 * query, the error and fatal counts both from the level breakdown — so
 * splitting further would make four boundaries resolve at the same instant and
 * add three skeletons that flash for no reason.
 */
export async function KpiSection({
    range,
    eventsPerMinPromise,
    levelBreakdownPromise,
    alertRulesPromise,
}: KpiSectionProps) {
    const [buckets, levels, alertRules] = await Promise.all([
        eventsPerMinPromise,
        levelBreakdownPromise,
        alertRulesPromise,
    ]);

    const spark = sparklines(buckets);
    const errors = errorCount(levels);
    const fatals = fatalCount(levels);
    const firing = firingRules(alertRules);

    return (
        <>
            <div className={styles.span3}>
                <KpiCard
                    label="Events / min"
                    value={eventsPerMinuteRate(buckets, range)}
                    unit="/ min"
                    sparklineData={spark.total}
                    sparklineColor="cyan"
                    footerLeft={`over last ${range.type === "preset" ? range.value : "range"}`}
                />
            </div>
            <div className={styles.span3}>
                <KpiCard
                    label="Errors"
                    value={errors.toLocaleString()}
                    sparklineData={spark.errors}
                    sparklineColor="red"
                    footerLeft="error + fatal"
                    critical={errors > 0}
                />
            </div>
            <div className={styles.span3}>
                <KpiCard
                    label="Fatal"
                    value={fatals.toLocaleString()}
                    sparklineData={spark.fatal}
                    sparklineColor="pink"
                    footerLeft="fatal events"
                    critical={fatals > 0}
                />
            </div>
            <div className={styles.span3}>
                <KpiCard
                    label="Firing alerts"
                    value={firing.length.toString()}
                    valueColor="orange"
                    footerLeft={`of ${alertRules.length} rules total`}
                    critical={firing.length > 0}
                >
                    {firing.length > 0 && (
                        <ul className={styles.firingList}>
                            {firing.slice(0, 3).map((r) => (
                                <li key={r.id} className={styles.firingItem}>
                                    <span className={styles.firingDot} />
                                    <span className={styles.firingName}>{r.name}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </KpiCard>
            </div>
        </>
    );
}
