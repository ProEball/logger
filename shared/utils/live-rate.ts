/**
 * The live per-minute rate, as a display string.
 *
 * Below 1 it is shown to two decimals rather than rounded, because a quiet
 * project rounding to `0` reads as "nothing is arriving" when the real answer
 * is "something is, slowly".
 *
 * **Moved out of `features/dashboard/utils/dashboard-kpis.ts` on 2026-08-25.**
 * It was a KPI-row formatter until the rate left the dashboard entirely for the
 * application top bar, where it now reads on every project page. `shared/` is
 * where it has to live for the top bar to use it without `features/projects`
 * importing `features/dashboard` — `PROJECT.md` §2.1, a rule this repository
 * already breaks 54 times and does not need a 55th.
 */
export function liveRate(eventsLastMinute: number): string {
    return eventsLastMinute < 1
        ? eventsLastMinute.toFixed(2)
        : Math.round(eventsLastMinute).toLocaleString();
}
