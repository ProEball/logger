import {
    TIME_RANGE_PRESETS,
    type TimeRange,
    type TimeRangePreset,
} from "@/shared/utils/event-filters.schema";

/**
 * The filters both dashboards read out of the URL, and the arithmetic that
 * turns them into a query.
 *
 * **Why this is one module (2026-08-25).** The organization overview and the
 * project dashboard asked the same questions through two parallel stacks. On
 * range alone there were *four* lists of presets: `TIME_RANGE_PRESETS` in the
 * shared schema, `DASHBOARD_PRESETS` deriving from it, `OVERVIEW_PRESETS`
 * restating the same six values as a fresh literal, and
 * `DASHBOARD_SEGMENT_PRESETS` offering four of them. Consolidating parsers on
 * 2026-08-21 is documented in `dashboard-range.ts` as fixing exactly this — and
 * it fixed it on one page while the other kept its own copy, which is the same
 * shape as the filter-bar defect found the same day (see
 * `shared/hooks/use-filter-params.ts`).
 *
 * The organization page is the project page over several projects. Everything
 * that differs between them is a **parameter**, not a second implementation.
 */

export const DASHBOARD_PRESETS: readonly TimeRangePreset[] = TIME_RANGE_PRESETS;

export const DEFAULT_PRESET: TimeRangePreset = "1h";

/**
 * How finely a chart is sliced.
 *
 * The one thing that legitimately differs between the two pages. The project
 * dashboard's 1-hour view is a live minute-by-minute tail — sixty points, one
 * per minute, which is what makes it useful while watching an incident. The
 * organization chart draws one series *per project*, so sixty points times five
 * projects is three hundred marks on a sparkline-height chart, and it trades
 * that resolution for legibility.
 *
 * Everywhere else the two now agree. See {@link BUCKET_SECONDS}.
 */
export type BucketDensity = "fine" | "coarse";

/**
 * Seconds per chart bucket, per preset and density.
 *
 * **This replaced `pickBucket()`, which was not a table but four width steps —
 * 1m, 1h, 12h, 1d — chosen by range length.** With only four widths available
 * the fit was poor at both ends, and at 6 hours it was a defect rather than a
 * compromise: a 3600-second bucket over 6 hours is **six points**, six marks to
 * describe six hours, against the twenty-four the overview drew for the same
 * range. Nothing recorded that as intended; it falls out of the step function.
 *
 * So the widths are enumerated instead of computed. Every cell is 12–60 points,
 * which is the band the overview's table already targeted, and the two densities
 * differ in exactly one cell — the live-tail case the type doc above explains.
 *
 * Both routes read `bucketSecs` from {@link parseDashboardFilters} and pass it
 * to the query, so neither computes a width of its own any more. The project
 * dashboard's 6h chart went from six points to twenty-four when it adopted this
 * on 2026-08-25 — a visible change, and the point of the exercise.
 */
export const BUCKET_SECONDS: Record<BucketDensity, Record<TimeRangePreset, number>> = {
    fine: {
        "15m": 60,
        "1h": 60,
        "6h": 900,
        "24h": 3600,
        "7d": 21600,
        "30d": 86400,
    },
    coarse: {
        "15m": 60,
        "1h": 300,
        "6h": 900,
        "24h": 3600,
        "7d": 21600,
        "30d": 86400,
    },
};

export function bucketSecondsFor(preset: TimeRangePreset, density: BucketDensity): number {
    return BUCKET_SECONDS[density][preset];
}

const VALID_PRESETS = new Set<string>(DASHBOARD_PRESETS);

/**
 * Reads a `range` search param into a preset.
 *
 * Accepts every shape either caller has: a route receives `string | string[] |
 * undefined` from Next, a client hook receives `string | null` from
 * `URLSearchParams.get`. Anything unrecognised — a repeated param arriving as an
 * array, a typo, an absent value — degrades to the default rather than throwing,
 * because this comes straight from a URL a user can type.
 */
export function parseRangePreset(raw: string | string[] | undefined | null): TimeRangePreset {
    return typeof raw === "string" && VALID_PRESETS.has(raw)
        ? (raw as TimeRangePreset)
        : DEFAULT_PRESET;
}

/** The same, as the `TimeRange` shape the services take. */
export function parseRange(raw: string | string[] | undefined | null): TimeRange {
    return { type: "preset", value: parseRangePreset(raw) };
}

const PRESET_OFFSETS_MS: Record<TimeRangePreset, number> = {
    "15m": 15 * 60_000,
    "1h": 60 * 60_000,
    "6h": 6 * 60 * 60_000,
    "24h": 24 * 60 * 60_000,
    "7d": 7 * 24 * 60 * 60_000,
    "30d": 30 * 24 * 60 * 60_000,
};

/**
 * A `TimeRange` as concrete instants.
 *
 * `to` is `now()`, which is why a **resolved range must never be a cache key** —
 * it would be unique to the millisecond and hit exactly never. Keys carry the
 * preset; see `shared/utils/query-cache-key.ts`.
 *
 * A **`custom`** range is not reachable from a URL and never has been: no caller
 * emits one, so no caller can receive one. It is handled here because the
 * benchmarks construct one directly.
 */
export function resolveRange(range: TimeRange): { from: Date; to: Date } {
    if (range.type === "custom") {
        return { from: new Date(range.from), to: new Date(range.to) };
    }
    const now = new Date();
    return { from: new Date(now.getTime() - PRESET_OFFSETS_MS[range.value]), to: now };
}

/** Minutes a preset spans. Used for rates, which divide by it. */
export function presetMinutes(preset: TimeRangePreset): number {
    return PRESET_OFFSETS_MS[preset] / 60_000;
}

export type RawSearchParams = Record<string, string | string[] | undefined>;

export interface DashboardFilters {
    /** Validated preset; an unknown or missing `range` falls back to the default. */
    preset: TimeRangePreset;
    /** The same, shaped for the services. */
    range: TimeRange;
    /** Bucket width for the chart, in seconds. */
    bucketSecs: number;
    /** Selected environment, for the filter bar. Empty means "all". */
    environment: string;
    /** The same, shaped for the service layer: `undefined` means unfiltered. */
    environmentsFilter: string[] | undefined;
}

/**
 * Parse a dashboard URL's search params into everything either page needs.
 *
 * Every unrecognised or malformed input degrades to the default rather than
 * throwing: these values come straight from a URL a user can type. A repeated
 * param (`?env=a&env=b`) arrives as an array and is **dropped, not guessed at** —
 * the filter bar only ever emits the single-value form.
 */
export function parseDashboardFilters(
    rawSearch: RawSearchParams,
    density: BucketDensity,
): DashboardFilters {
    const preset = parseRangePreset(rawSearch.range);
    const environment = typeof rawSearch.env === "string" ? rawSearch.env : "";

    return {
        preset,
        range: { type: "preset", value: preset },
        bucketSecs: bucketSecondsFor(preset, density),
        environment,
        environmentsFilter: environment ? [environment] : undefined,
    };
}
