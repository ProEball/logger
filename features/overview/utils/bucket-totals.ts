import type { OrgEventBucket } from "@/features/overview/services/overview.service";

/**
 * Collapse per-project buckets into one series of org-wide totals, ordered
 * oldest first.
 *
 * `getOrgEventBuckets` returns one row per (project, timestamp) pair, so a
 * timestamp appears once per project that had events in it. The KPI sparkline
 * wants a single line for the whole organization, which means summing across
 * projects before plotting.
 *
 * Ordering is by timestamp value, not by the order rows arrived: the SQL
 * orders by `ts` but a project with no events in a bucket simply has no row
 * there, so arrival order is not a usable series.
 */
export function totalsByTimestamp(buckets: OrgEventBucket[]): number[] {
    const byTs = new Map<number, number>();
    for (const bucket of buckets) {
        const key = bucket.ts.getTime();
        byTs.set(key, (byTs.get(key) ?? 0) + bucket.count);
    }
    return [...byTs.entries()].sort(([a], [b]) => a - b).map(([, total]) => total);
}
