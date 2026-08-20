import { OVERVIEW_PRESETS, type OverviewPreset } from "@/features/overview/utils/overview-filters";

/**
 * The widest window the "Top errors across org" widget will aggregate over.
 *
 * That widget is the one query on the page that cannot come from the rollup —
 * it groups by message, and 168k distinct messages per 500k events cannot be
 * pre-aggregated at a fixed grain. It therefore runs against raw `events`, and
 * `EXPLAIN` shows where its time goes: the index on
 * `(project_id, level, timestamp)` finds the rows in 0.35 ms, but fetching them
 * costs 2,133 heap blocks for 2,785 rows — roughly one random page per row,
 * because errors are ~7% of events and scattered among the rest.
 *
 * So the cost is proportional to the number of matching rows, and the only
 * lever left is to match fewer. Capping the window does exactly that, linearly:
 * a 30-day page range would otherwise have this widget aggregating 30 days of
 * errors, which is the worst case and is reachable by one click.
 *
 * Measured on a 500k-event corpus: 23.2 ms over 72 h, 12.4 ms over 24 h, 6.6 ms
 * over 1 h — of which about 6 ms is fixed cost (planning, partition access,
 * round trip) that no window size reduces.
 */
export const TOP_ERRORS_MAX_PRESET: OverviewPreset = "24h";

export interface TopErrorsWindow {
    /** The preset actually queried — never wider than the cap. */
    preset: OverviewPreset;
    /** True when the page asked for more than the cap allows. */
    isClamped: boolean;
}

/**
 * Narrow the page's range for the top-errors widget.
 *
 * Never *widens*: a widget showing more than the page asked for would be
 * surprising in the other direction. A page on 15 minutes gets 15 minutes of
 * errors; a page on 30 days gets 24 hours, and the widget says so.
 *
 * Deliberately not a user-facing control. A selector buys the ability to pick a
 * window, which nobody has asked for, at the cost of a second time filter on a
 * page that already has one — "why does the chart say 30 days and the errors
 * say 15 minutes?". Add it when there is a request naming the windows it needs.
 */
export function clampTopErrorsWindow(preset: OverviewPreset): TopErrorsWindow {
    const order = OVERVIEW_PRESETS.indexOf(preset);
    const capOrder = OVERVIEW_PRESETS.indexOf(TOP_ERRORS_MAX_PRESET);

    // OVERVIEW_PRESETS is ordered shortest to longest, so position is width.
    if (order === -1 || order <= capOrder) {
        return { preset, isClamped: false };
    }
    return { preset: TOP_ERRORS_MAX_PRESET, isClamped: true };
}
