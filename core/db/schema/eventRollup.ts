import { integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { projects } from "./projects";

/**
 * Per-minute event counts, rebuilt from `events` by a scheduled job.
 *
 * The dashboards read this instead of aggregating `events` on every page load.
 * `pg_stat_statements` put the org overview's aggregations at ~74% of its
 * database time (2026-08-20), and that cost was paid per viewer: two people
 * opening the same dashboard in the same second each ran the full set, over
 * slightly different `now()` values, and saw slightly different numbers.
 *
 * One row per `(project, minute, environment)` since 2026-08-25. It was
 * `(project, minute)` with environment kept as a `by_env` marginal, and that
 * design was **measured wrong**: `by_level` and `by_env` could each be summed
 * alone but neither could answer "how many errors in production", so every
 * environment-filtered read fell back to scanning raw `events`. Benchmarked
 * 2026-08-25 on 500k events, that cost `projectStats` 4.47 ms → 17.20 and
 * `levelBreakdown` 7.16 → 15.36, and it was the reason the volume chart could
 * not show an error ratio under a filter at all.
 *
 * **The original objection was real and is answered by the cap, not dismissed.**
 * `environment` is `z.string().max(128)` at ingest, so a project sending a
 * unique value per deploy would multiply rows without bound. The tail beyond
 * `ENVIRONMENT_KEY_CAP` folds into a single `(other)` row per minute, so the
 * multiplier is bounded by the cap rather than by the client. What the previous
 * design got wrong was the *shape*: a cross product inside jsonb would indeed
 * have made every 30-day read walk a nested object, but a key column is not a
 * cross product — it is one more integer comparison in an index.
 *
 * **`(other)` is load-bearing.** A minute that folded anything is a minute whose
 * per-environment counts are incomplete, so a *filtered* read must not use it.
 * Readers check for it rather than trusting the cap to have been generous
 * enough — see `envRollupFloor` in `event-aggregations.service.ts`. That check
 * is exact in the only direction that matters: it never serves a wrong number,
 * it only sometimes does more work.
 *
 * Only minutes that had events get a row. Materialising empty minutes would
 * mean 1,440 rows per project per day regardless of traffic — more rows than
 * events on a quiet project, which is the one case where a rollup should cost
 * nothing.
 */
export const eventRollupMinutes = pgTable(
    "event_rollup_minutes",
    {
        projectId: uuid("project_id")
            .notNull()
            .references(() => projects.id, { onDelete: "cascade" }),
        /** Start of the minute, `date_trunc('minute', timestamp)`. */
        minute: timestamp("minute", { withTimezone: true }).notNull(),
        /**
         * The environment these counts belong to — part of the key since
         * 2026-08-25. Three values are reserved and none can come from a client,
         * because ingest never writes a name in parentheses:
         *
         * - `(unset)` — the event carried no environment. Already the label every
         *   read used for that case, so nothing downstream changed.
         * - `(other)` — the tail beyond `ENVIRONMENT_KEY_CAP` for this minute,
         *   folded together. **Its presence in a range is what tells a reader a
         *   filtered question cannot be answered here**, so it is a signal, not
         *   just a bucket.
         * - `(all)` — stamped by migration 0014 on rows that predate this column
         *   and therefore mix every environment together. Summing across it is
         *   exact; a filtered read must not touch it.
         */
        environment: text("environment").notNull(),
        total: integer("total").notNull(),
        /** `{"info": 412, "error": 7}` — counts per level within this minute. */
        byLevel: jsonb("by_level").notNull().default(sql`'{}'::jsonb`),
        /**
         * `{"api": 402, "worker": 49}` — counts per source, capped like
         * `by_env` and folded into `(other)` beyond the cap.
         *
         * Added 2026-08-24, and it is the column §16.2 deferred on 2026-08-21
         * with a condition attached: *"it should be a number measured at 30 days
         * rather than a wish for a tidy table."* The number arrived on the
         * resized host — `topSources` at **856 ms and 29–41% of its time in
         * blk_read_time**, the slowest query on either dashboard and the only
         * one still scanning raw `events` across the whole range. Everything
         * else reads a rollup and sits at 0% I/O.
         *
         * jsonb rather than a key column, on the same reasoning as `by_env`:
         * `source` is client-supplied. A row-per-value key would let a project
         * inventing a source per deploy multiply the table; a capped JSON object
         * turns that into a fatter row instead.
         *
         * **An empty object means "written before this column existed"**, not
         * "no sources". Every event has a source or `(unknown)`, so a rebuilt
         * row always carries at least one key — which is what lets
         * `topSources` tell a pre-migration row from a genuinely quiet minute
         * without a second watermark column.
         */
        bySource: jsonb("by_source").notNull().default(sql`'{}'::jsonb`),
        /**
         * Derived, not stored twice. `errors` is read on nearly every widget,
         * and a generated column keeps the fast `SUM(errors)` path without
         * letting it drift from `by_level` — the job writes only the JSON.
         */
        errors: integer("errors").generatedAlwaysAs(
            sql`COALESCE((by_level->>'error')::int, 0) + COALESCE((by_level->>'fatal')::int, 0)`,
        ),
        /** When this row was last rebuilt. Surfaced in the UI as "data as of …". */
        computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => ({
        pk: primaryKey({ columns: [t.projectId, t.minute, t.environment] }),
    }),
);

/**
 * How far back the next rollup rebuild must start, per project.
 *
 * Without it, a job that rebuilds "the last few minutes" would never revisit a
 * bucket that an old event landed in — and ingest accepts timestamps up to 30
 * days old. `events` records the time of the event, not the time it arrived,
 * so nothing in that table can distinguish a late arrival; the ingest path has
 * to say so, and this is where it says it.
 */
export const rollupState = pgTable("rollup_state", {
    projectId: uuid("project_id")
        .primaryKey()
        .references(() => projects.id, { onDelete: "cascade" }),
    refreshFrom: timestamp("refresh_from", { withTimezone: true }).notNull().defaultNow(),
    /**
     * Exclusive upper bound the rollup is complete to. `NULL` until the first
     * run finishes.
     *
     * Readers need this, not just the watermark: the rollup only ever holds
     * *closed* minutes, so the newest minute — the one that matters most while
     * watching an incident — is never in it. Reads take the rollup below this
     * boundary and raw `events` above it, which is also what keeps a freshly
     * ingested event visible immediately instead of a minute later.
     *
     * It cannot be derived from `refresh_from`: after a run that is still
     * catching up, `refresh_from` says where to resume, which is far behind
     * where the data is complete to.
     */
    rolledUpTo: timestamp("rolled_up_to", { withTimezone: true }),
    /**
     * Exclusive upper bound the **template** rollup is complete to. `NULL`
     * until its first run.
     *
     * Separate from `rolledUpTo`, and that separation is the whole point rather
     * than tidiness. The two rollups start at different moments: the level
     * rollup has run since 2026-08-20, while the template rollup can only cover
     * events that carry a `template_hash`, and nothing ingested before its
     * deploy does. Sharing one watermark would have the template read claim
     * coverage it does not have and return **zero** for older minutes — a
     * silent wrong answer, which on a "top messages" widget looks exactly like
     * a quiet project.
     *
     * A read whose range starts before this boundary therefore cannot use the
     * template rollup at all, and falls back to grouping raw `events` by text —
     * the query that exists today. That is slow and correct, and it stops being
     * needed as 30-day retention rolls the pre-deploy events out.
     */
    /**
     * Oldest minute the template rollup actually covers. `NULL` until its first
     * run.
     *
     * The upper watermark alone cannot express this rollup's coverage, and
     * finding that out is why this column exists. Events ingested before
     * `template_hash` shipped carry no fingerprint and can never enter the
     * template rollup — so coverage is an *interval*, not a prefix. A reader
     * holding only `templates_rolled_up_to` would take a 7-day range, see it
     * ends below the watermark, read the rollup for all of it, and silently
     * miss every pre-deploy event. On "top messages" that undercount looks
     * exactly like a message nobody sent.
     *
     * Moves backwards, never forwards: a catch-up run that rebuilds an older
     * window widens the covered interval, so this takes the `LEAST` of what is
     * stored and what was just built.
     */
    templatesRolledUpFrom: timestamp("templates_rolled_up_from", { withTimezone: true }),
    templatesRolledUpTo: timestamp("templates_rolled_up_to", { withTimezone: true }),
});

export type EventRollupMinute = typeof eventRollupMinutes.$inferSelect;
export type RollupState = typeof rollupState.$inferSelect;
