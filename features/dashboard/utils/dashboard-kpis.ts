import type { BucketRow } from "@/features/dashboard/utils/aggregation-utils";
import type { LevelCount } from "@/features/dashboard/services/aggregations.service";
import type { TimeRange, TimeRangePreset } from "@/shared/utils/event-filters.schema";

/**
 * The arithmetic behind the dashboard's KPI row.
 *
 * Extracted from `DashboardPage.tsx` on 2026-08-21, where it sat inside a
 * client component and could not be reached by a test — `WORKFLOW.md` §2 counts
 * "anything with a branch, a boundary, or a rule" as logic, and each of these
 * has one: a rate below 1 formats differently, an unknown preset falls back to
 * an hour, and "errors" means error *and* fatal while "fatal" means only fatal.
 *
 * They are also what the KPI row needs in order to be its own `Suspense`
 * boundary: a server section can call them, a client component's private
 * function cannot.
 */

const PRESET_MINUTES: Record<TimeRangePreset, number> = {
    "15m": 15,
    "1h": 60,
    "6h": 360,
    "24h": 1440,
    "7d": 10080,
    "30d": 43200,
};

/**
 * Average events per minute over the range, as a display string.
 *
 * Below 1 it is shown to two decimals rather than rounded, because a quiet
 * project rounding to "0" reads as "nothing is arriving" when the real answer
 * is "something is, slowly". Above 1 it is rounded and thousands-separated.
 *
 * A custom range falls back to 60 minutes. Nothing reachable from the URL
 * produces one (see `dashboard-range.ts`), so this is a floor rather than a
 * behaviour anyone can observe.
 */
export function eventsPerMinuteRate(buckets: BucketRow[], range: TimeRange): string {
    const total = buckets.reduce((sum, b) => sum + b.total, 0);
    const minutes = range.type === "preset" ? (PRESET_MINUTES[range.value] ?? 60) : 60;
    const rate = total / minutes;
    return rate < 1 ? rate.toFixed(2) : Math.round(rate).toLocaleString();
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
export function sparklines(buckets: BucketRow[]): {
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
