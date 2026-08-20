/**
 * URL search-param parsing for the organization overview.
 *
 * Extracted from `app/[org]/(org-shell)/page.tsx` on 2026-08-20. Two reasons,
 * in order of weight: it is business logic in a route file, which PROJECT.md
 * §2.3 forbids and which nothing can unit-test where it sat; and it is part of
 * what PLAN.md §16.1 Stage D rewrites, so it needs a test net before that
 * starts rather than after.
 *
 * Range resolution deliberately stays out of here — the route calls
 * `resolveRange()` from the dashboard feature, because a feature importing
 * another feature is a §2.1 violation and a route composing two of them is not.
 */

export const OVERVIEW_PRESETS = ["15m", "1h", "6h", "24h", "7d", "30d"] as const;

export type OverviewPreset = (typeof OVERVIEW_PRESETS)[number];

export const DEFAULT_OVERVIEW_PRESET: OverviewPreset = "1h";

/**
 * Seconds per chart bucket, per preset.
 *
 * These do **not** agree with `pickBucket()` in `features/dashboard` — for a
 * 1h range this yields 300s where the project dashboard yields 60s. The org
 * chart draws one series per project, so it trades resolution for a readable
 * number of points. Two bucketing rules in one app is a wart rather than a
 * design, but unifying them changes what the chart shows; that is a Stage D/E
 * decision, not something a refactor gets to do quietly.
 */
export const OVERVIEW_BUCKET_SECONDS: Record<OverviewPreset, number> = {
    "15m": 60,
    "1h": 300,
    "6h": 900,
    "24h": 3600,
    "7d": 3600 * 6,
    "30d": 3600 * 24,
};

export interface OverviewFilters {
    /** Validated preset; an unknown or missing `range` falls back to the default. */
    preset: OverviewPreset;
    /** Bucket width for the volume chart, in seconds. */
    bucketSecs: number;
    /** Selected levels, for the filter bar. Empty means "no level filter". */
    levels: string[];
    /** The same, shaped for the service layer, which reads absent as "all". */
    levelsFilter: string[] | undefined;
    /** Selected environment, for the filter bar. Empty means "all". */
    environment: string;
    /** The same, shaped for the service layer. */
    environmentsFilter: string[] | undefined;
    /** Query string handed to the client filter bar so it can preserve state. */
    searchString: string;
}

function isOverviewPreset(value: string): value is OverviewPreset {
    return (OVERVIEW_PRESETS as readonly string[]).includes(value);
}

export type RawSearchParams = Record<string, string | string[] | undefined>;

/**
 * Parse the overview's search params into everything the page needs.
 *
 * Every unrecognised or malformed input degrades to the default rather than
 * throwing: these values come straight from a URL a user can type.
 */
export function parseOverviewFilters(rawSearch: RawSearchParams): OverviewFilters {
    const rawRange = typeof rawSearch.range === "string" ? rawSearch.range : "";
    const preset = isOverviewPreset(rawRange) ? rawRange : DEFAULT_OVERVIEW_PRESET;

    const rawLevels = typeof rawSearch.levels === "string" ? rawSearch.levels : "";
    const levels = rawLevels ? rawLevels.split(",").filter(Boolean) : [];

    const environment = typeof rawSearch.env === "string" ? rawSearch.env : "";

    // Repeated params (`?env=a&env=b`) arrive as an array and are dropped, not
    // guessed at — the filter bar only ever emits the single-value form.
    const searchString = Object.entries(rawSearch)
        .filter(([, v]) => typeof v === "string" && v !== "")
        .map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`)
        .join("&");

    return {
        preset,
        bucketSecs: OVERVIEW_BUCKET_SECONDS[preset],
        levels,
        levelsFilter: levels.length > 0 ? levels : undefined,
        environment,
        environmentsFilter: environment ? [environment] : undefined,
        searchString,
    };
}
