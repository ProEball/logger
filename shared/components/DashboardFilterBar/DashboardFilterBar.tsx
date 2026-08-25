"use client";
import { AutoRefreshControl } from "@/shared/components/AutoRefreshControl/AutoRefreshControl";
import { useFilterParams } from "@/shared/hooks/use-filter-params";
import { DASHBOARD_PRESETS } from "@/shared/utils/dashboard-filters";
import styles from "./DashboardFilterBar.module.scss";

/**
 * The filter bar for **both** dashboards: range, environment, auto-refresh.
 *
 * It was `features/overview/components/OverviewFilterBar` until 2026-08-25,
 * while the project dashboard had a four-preset segmented control inside its
 * page header instead. Two controls for one job, offering different ranges —
 * `15m` and `6h` simply did not exist on the project page, so a link between the
 * two dashboards could land on a range the other could not show.
 *
 * It carried `leading` and `trailing` slots for four days after that merge, so
 * the project dashboard could keep its title, live rate and "+ New alert" link
 * on this row. Both are gone: the title and rate moved to the application top
 * bar (`ProjectPulse`) because an unbounded project name crowded the
 * fixed-width pill run beside it, and the alert shortcut was dropped as a third
 * copy of a button the alerts page already shows twice. Both dashboards now
 * pass the same three props.
 *
 * ## What it filters, and what it does not
 *
 * Level chips were removed on 2026-08-20. They reached three of the overview's
 * eight widgets and left the other five visibly unchanged: the volume chart
 * ignored level filters by construction, the level breakdown is *about* levels
 * so narrowing to one would empty it, and the per-project top message never
 * received the filter at all. A control that moves three things and leaves five
 * alone does not read as a filter with a documented scope; it reads as a broken
 * filter. The per-project drill-down it offered still exists on the events page,
 * where filtering applies to everything on screen.
 *
 * Rejected then: making it reach all eight instead. Both objections have since
 * been answered by other work — the chart takes an environment filter and the
 * top-message defect is gone — but nobody has asked for level chips back, so
 * they stay out until someone does.
 *
 * ## Pending state
 *
 * Added 2026-08-25. Until then this pushed a URL bare, with no transition and no
 * optimistic selection — so a click produced no visible change whatsoever until
 * the server answered: the pill did not restyle, and a transition holds the
 * current UI so no skeleton appeared either. The project dashboard had the
 * identical defect diagnosed and fixed on 2026-08-22 and the fix was never
 * carried here, because it lived inside that feature's own hook.
 *
 * What turned it up was benchmarking the overview's SQL: 19–25 ms on a
 * 500k-event corpus cannot account for a wait anyone would notice, so the wait
 * being reported was the missing feedback, not the query. The mechanism is now
 * `shared/hooks/use-filter-params.ts` — one copy, so it cannot drift again.
 */
interface DashboardFilterBarProps {
    /** Server-validated range preset — what the page actually fetched. */
    range: string;
    /** Server-validated environment; empty means all. */
    environment: string;
    /**
     * Environments this scope has used. Empty hides the group entirely rather
     * than rendering a lone "All envs" pill that narrows nothing.
     */
    environments: string[];
}

const FILTER_KEYS = ["range", "env"] as const;

export function DashboardFilterBar({
    range,
    environment,
    environments,
}: DashboardFilterBarProps) {
    const { values, displayValues, isPending, setParam } = useFilterParams(FILTER_KEYS);

    /**
     * Prefer the optimistic value, fall back to the server's.
     *
     * `displayValues` differs from `values` exactly while a write to that key is
     * in flight, so this takes the clicked value then and the **validated** prop
     * otherwise. That matters: `values` comes straight off the URL, so a typed
     * `?range=42h` would highlight nothing while the page renders 1h. Comparing
     * the two rather than validating a second time keeps `parseDashboardFilters`
     * the only place that decides what a valid preset is.
     */
    const shownRange = displayValues.range !== values.range ? displayValues.range : range;
    const shownEnv = displayValues.env !== values.env ? displayValues.env : environment;

    // Only the pills dim — see the note on auto-refresh below for why it is
    // excluded rather than the whole bar being greyed.
    const groupClass = isPending ? `${styles.group} ${styles.groupPending}` : styles.group;

    return (
        <div className={styles.bar} aria-busy={isPending}>
            <div className={groupClass} role="group" aria-label="Time range">
                {DASHBOARD_PRESETS.map((p) => (
                    <button
                        key={p}
                        type="button"
                        className={`${styles.pill} ${shownRange === p ? styles.pillActive : ""}`}
                        onClick={() => setParam("range", p)}
                    >
                        {p}
                    </button>
                ))}
            </div>

            {environments.length > 0 && (
                <>
                    <div className={styles.sep} />
                    <div className={groupClass} role="group" aria-label="Environments">
                        <button
                            type="button"
                            className={`${styles.pill} ${shownEnv === "" ? styles.pillActive : ""}`}
                            onClick={() => setParam("env", "")}
                        >
                            All envs
                        </button>
                        {environments.map((env) => (
                            <button
                                key={env}
                                type="button"
                                className={`${styles.pill} ${shownEnv === env ? styles.pillActive : ""}`}
                                onClick={() => setParam("env", env)}
                            >
                                {env}
                            </button>
                        ))}
                    </div>
                </>
            )}

            {/*
              * Auto-refresh, added 2026-08-20 — the overview was the only
              * dashboard without it. Trailing edge and behind a spacer, because
              * it changes how often the page reloads rather than what it shows,
              * and sitting in the run of filter pills would read as a third
              * filter.
              *
              * Outside the dimmed region on purpose: it is not part of the
              * navigation in flight, and greying it would suggest the choice had
              * been rejected.
              *
              * Worth knowing: the shortest interval is 30 s and the read cache
              * TTL is also 30 s, so a refresh can land on a value up to 30 s old
              * — effective staleness reaches a minute. See
              * `event-aggregations-cache.service.ts`.
              */}
            <div className={styles.spacer}>
                <AutoRefreshControl />
            </div>
        </div>
    );
}
