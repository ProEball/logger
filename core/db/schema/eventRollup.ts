import { integer, jsonb, pgTable, primaryKey, timestamp, uuid } from "drizzle-orm/pg-core";
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
 * One row per `(project, minute)` — deliberately, rather than a row per
 * `(project, minute, level, environment)`. The finer key multiplies rows by
 * dimensions the *client* controls: `environment` is `z.string().max(128)` at
 * ingest, so a project sending a unique environment per deploy would multiply
 * the table without bound. Keeping the breakdowns inside one row degrades that
 * into a fatter row rather than a row explosion, and the key count is capped
 * (see `ENVIRONMENT_KEY_CAP` in the rollup service).
 *
 * **`by_level` and `by_env` are marginals, not a joint distribution.** Either
 * can be summed on its own; "how many errors in production" cannot be answered
 * from them, so a read filtering by level *and* environment at once falls back
 * to `events`. Storing the cross product instead would make every 30-day read
 * walk a nested object on 43,200 rows per project to serve a rare filter.
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
        total: integer("total").notNull(),
        /** `{"info": 412, "error": 7}` — counts per level within this minute. */
        byLevel: jsonb("by_level").notNull().default(sql`'{}'::jsonb`),
        /** `{"production": 380, "(unset)": 39}` — counts per environment. */
        byEnv: jsonb("by_env").notNull().default(sql`'{}'::jsonb`),
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
        pk: primaryKey({ columns: [t.projectId, t.minute] }),
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
});

export type EventRollupMinute = typeof eventRollupMinutes.$inferSelect;
export type RollupState = typeof rollupState.$inferSelect;
