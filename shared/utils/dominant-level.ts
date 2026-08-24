import { EVENT_LEVELS } from "@/shared/utils/event-filters.schema";

export type EventLevel = (typeof EVENT_LEVELS)[number];

/** Per-level occurrence counts within one group of events. */
export type LevelCounts = Record<EventLevel, number>;

/**
 * The level to badge a group of events with: the one that occurs most, ties
 * broken toward the **more severe** level.
 *
 * Replaces `mode() WITHIN GROUP (ORDER BY level)` in `topMessages`, and the
 * reason is not style. `mode()` is an *ordered-set* aggregate, which requires
 * sorted input per group — so while one sits in the select list, Postgres
 * cannot use `HashAggregate` at any `work_mem`. That single call pinned the
 * whole query to sort-then-group. Measured on staging, 2026-08-22, 8.9M events,
 * a 7-day range: **26,855 ms with `mode()`, 17,021 ms without**, the plan
 * gaining `Partial HashAggregate` with `Batches: 1` and no spill. Details and
 * the three hypotheses this refuted are in `PLAN.md` §16.3.
 *
 * The tie-break is a deliberate improvement rather than a faithful port.
 * `mode()` picks arbitrarily among equally frequent values; a widget whose job
 * is "what should I look at" should resolve a tie toward the thing more worth
 * looking at. `EVENT_LEVELS` is ordered least to most severe, so scanning it in
 * order and preferring later values on equality gives exactly that.
 */
export function pickDominantLevel(counts: Partial<LevelCounts>): EventLevel {
    let dominant: EventLevel | null = null;
    let best = 0;

    for (const level of EVENT_LEVELS) {
        const n = counts[level] ?? 0;
        // `>=` rather than `>`: EVENT_LEVELS runs least to most severe, so a tie
        // resolves toward the more severe level as it is reached later.
        if (n > 0 && n >= best) {
            best = n;
            dominant = level;
        }
    }

    if (dominant === null) {
        // Unreachable through the query: a row only exists because GROUP BY
        // found at least one event for it. Thrown rather than defaulted because
        // every default here is a badge that silently misreports severity, and
        // "fatal" — what the tie-break would otherwise return for all-zero — is
        // the worst possible wrong answer.
        throw new Error("pickDominantLevel: no level has a positive count");
    }

    return dominant;
}

/**
 * The shape a rollup read returns level counts in since 2026-08-24: one `int`
 * column per level, named `n_<level>`.
 *
 * Declared here rather than in either service because both the dashboard's
 * `topMessages` and the overview's per-project top message select it, and a
 * second copy of a five-field row shape is exactly the drift this repository
 * keeps paying for.
 */
export type RollupLevelRow = {
    n_debug: number;
    n_info: number;
    n_warn: number;
    n_error: number;
    n_fatal: number;
};

/**
 * Turns those five columns into the map `pickDominantLevel` takes.
 *
 * `Number(...)` rather than a bare read: a generated `int` column comes back as
 * a number from postgres.js, but `SUM(...)::int` in a CTE has arrived as a
 * string often enough in this codebase that trusting the driver here would be
 * the kind of assumption that produces a badge computed from `NaN`.
 *
 * The five names are restated here and in the SQL rather than derived from
 * `EVENT_LEVELS`, because deriving would mean generating column aliases into a
 * raw query. What keeps the two in step is the integration test that iterates
 * `EVENT_LEVELS` and asserts every level can come back as some message's badge:
 * a level added to the schema and forgotten here leaves that message with no
 * positive count, and `pickDominantLevel` throws rather than badging it wrongly.
 */
export function levelCounts(row: RollupLevelRow): Partial<LevelCounts> {
    return {
        debug: Number(row.n_debug),
        info: Number(row.n_info),
        warn: Number(row.n_warn),
        error: Number(row.n_error),
        fatal: Number(row.n_fatal),
    };
}
