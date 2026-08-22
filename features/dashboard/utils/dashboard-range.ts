import { TIME_RANGE_PRESETS, type TimeRange, type TimeRangePreset } from "@/shared/utils/event-filters.schema";

/**
 * The dashboard's range presets and the single parser for them.
 *
 * **Written 2026-08-21 because there were three lists and two parsers.**
 * `TIME_RANGE_PRESETS` in the shared schema, `DASHBOARD_PRESETS` in
 * `use-dashboard-range.ts`, and a hardcoded `Set` in
 * `app/[org]/[project]/page.tsx` — which also held its own second copy of
 * `parseRange`. All three agreed, by coincidence, and nothing would have
 * noticed when they stopped: adding a preset to the hook would have left the
 * route rejecting it and silently substituting `1h`.
 *
 * That is not a hypothetical. The identical shape — a list of allowed values
 * restated in a second place, with no mechanism keeping the copies honest —
 * shipped a live defect earlier the same day: `AutoRefreshValue` gained `5m`
 * while the Zod enum validating it did not, so choosing `5m` failed server-side
 * while the UI showed it selected. See `shared/types/user-preferences.types.ts`.
 *
 * So the presets are **derived** from the schema rather than restated, and the
 * parser lives in one place that both the route and the hook import.
 *
 * Range *resolution* deliberately stays out of here, in
 * `aggregation-utils.ts` — same split as the overview's `overview-filters.ts`.
 */
export const DASHBOARD_PRESETS: readonly TimeRangePreset[] = TIME_RANGE_PRESETS;

export const DEFAULT_DASHBOARD_PRESET: TimeRangePreset = "1h";

/**
 * The subset the header's segmented control offers. Deliberately narrower than
 * `DASHBOARD_PRESETS` — six buttons do not fit — but **typed as presets**, so a
 * value the parser would reject cannot be rendered as a button.
 *
 * It was a fourth free-standing literal in `DashboardHeader.tsx` until an audit
 * on 2026-08-21 pointed out that consolidating the three *parsing* lists had
 * left the *rendering* one alone: the module written to stop preset lists
 * drifting had not been wired to the only list a user can see.
 */
export const DASHBOARD_SEGMENT_PRESETS: readonly TimeRangePreset[] = ["1h", "24h", "7d", "30d"];

const VALID = new Set<string>(DASHBOARD_PRESETS);

/**
 * Reads a `range` search param into a `TimeRange`.
 *
 * Accepts whatever either caller has: the route receives `string | string[] |
 * undefined` from Next, the hook receives `string | null` from
 * `URLSearchParams.get`. Anything unrecognised — a repeated param arriving as
 * an array, a typo, an absent value — degrades to the default rather than
 * throwing, because this comes straight from a URL a user can type.
 *
 * A **`custom`** range is not parseable from the URL and never has been: no
 * caller emits one, so no caller can receive one. `resolveRange()` still
 * handles the custom shape, and the benchmarks use it, but nothing reachable
 * from a browser produces it. That is load-bearing for the cache — a resolved
 * date range in a cache key is unique to the millisecond and never hits.
 */
export function parseDashboardRange(raw: string | string[] | undefined | null): TimeRange {
    if (typeof raw === "string" && VALID.has(raw)) {
        return { type: "preset", value: raw as TimeRangePreset };
    }
    return { type: "preset", value: DEFAULT_DASHBOARD_PRESET };
}

/** The preset a `TimeRange` names, for keying a cache. `null` for a custom range. */
export function dashboardRangePreset(range: TimeRange): TimeRangePreset | null {
    return range.type === "preset" ? range.value : null;
}
