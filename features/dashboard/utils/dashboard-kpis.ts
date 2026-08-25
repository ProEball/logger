import type { EventBucket, LevelledBucket } from "@/shared/utils/event-buckets";
import type { LevelCount } from "@/shared/services/event-aggregations.service";

/**
 * The arithmetic behind the dashboard's KPI row.
 *
 * Extracted from `DashboardPage.tsx` on 2026-08-21, where it sat inside a
 * client component and could not be reached by a test — `WORKFLOW.md` §2 counts
 * "anything with a branch, a boundary, or a rule" as logic, and each of these
 * has one: "errors" means error *and* fatal while "fatal" means only fatal, and
 * a disabled rule left in the `firing` state is not firing.
 *
 * They are also what the KPI row needs in order to be its own `Suspense`
 * boundary: a server section can call them, a client component's private
 * function cannot.
 */

/**
 * Total events over the range, as a display string.
 *
 * **Replaced an averaged rate on 2026-08-25.** That KPI divided the range's
 * total by its length and called the result `events / min`, which at 30 days
 * meant a month's traffic over 43,200 — a number that moved for reasons
 * nobody could see and matched nothing else on the page. The organization
 * overview's first KPI has always been a plain total, and the two dashboards
 * now agree.
 *
 * The rate did not disappear: it moved to the application top bar and became a
 * reading about the **last minute**, which is a question this arithmetic could
 * not answer at all — see `eventsInLastMinute` and `shared/utils/live-rate.ts`.
 */
export function totalEvents(buckets: EventBucket[]): string {
    return buckets.reduce((sum, b) => sum + b.total, 0).toLocaleString();
}

/** Errors **and** fatals — the KPI is labelled "Errors" but counts both. */
export function errorCount(levels: LevelCount[]): number {
    return levels
        .filter((l) => l.level === "error" || l.level === "fatal")
        .reduce((sum, l) => sum + l.count, 0);
}

/** Fatals only, unlike {@link errorCount}. */
export function fatalCount(levels: LevelCount[]): number {
    return levels.filter((l) => l.level === "fatal").reduce((sum, l) => sum + l.count, 0);
}

/** The two fields of an alert rule the KPI row reads. */
export interface AlertRuleFlags {
    enabled: boolean;
    state: string | null;
}

/**
 * Rules that are both enabled and firing. A disabled rule left in the `firing`
 * state is not firing — it is switched off, and counting it would light the KPI
 * red for something nobody is watching.
 */
export function firingRules<T extends AlertRuleFlags>(rules: T[]): T[] {
    return rules.filter((r) => r.enabled && r.state === "firing");
}

/** Series for the KPI sparklines, in bucket order. */
export function sparklines(buckets: LevelledBucket[]): {
    total: number[];
    errors: number[];
    fatal: number[];
} {
    return {
        total: buckets.map((b) => b.total),
        errors: buckets.map((b) => (b.byLevel.error ?? 0) + (b.byLevel.fatal ?? 0)),
        fatal: buckets.map((b) => b.byLevel.fatal ?? 0),
    };
}
