import { bigint, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { projects } from "./projects";

/**
 * The distinct message templates a project has ever sent, one row each.
 *
 * `Session sess_ai6h2q expired` and `Session sess_pw62y expired` are one row
 * here — `Session *** expired` — with the identifier removed by
 * `normalizeMessage`. This is the display text for the template rollup, which
 * stores only the fingerprint.
 *
 * Measured on staging 2026-08-22: 674,634 distinct messages in a day collapse
 * to 18,080 templates, a factor of 37.3. That is what makes a rollup keyed by
 * template worth building at all — see `PLAN.md` §16.3.
 *
 * **The raw `message` on the event is never touched.** Normalising is a
 * heuristic over regular expressions, and it will be wrong sometimes; ingest is
 * a one-way door, so destroying `sess_ai6h2q` because a rule said so would be
 * irreversible. The event keeps what was sent, this keeps the grouping, and a
 * bad rule is fixed by a version bump rather than mourned.
 */
export const messageTemplates = pgTable(
    "message_templates",
    {
        projectId: uuid("project_id")
            .notNull()
            .references(() => projects.id, { onDelete: "cascade" }),
        /**
         * `templateHashForStorage(message)`. Signed because Postgres `bigint`
         * is, and folded exactly once on the way in.
         */
        templateHash: bigint("template_hash", { mode: "bigint" }).notNull(),
        /** The normalised text: `Session *** expired`. */
        template: text("template").notNull(),
        /**
         * Which rule generation produced this row. The version is already
         * folded into the hash, so two generations cannot collide — this is
         * here to make a migration between them *observable* rather than
         * possible.
         */
        normalizerVersion: integer("normalizer_version").notNull(),
        firstSeen: timestamp("first_seen", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => ({
        pk: primaryKey({ columns: [t.projectId, t.templateHash] }),
    }),
);

/**
 * Per-minute counts of events sharing a template.
 *
 * The same shape as `event_rollup_minutes` and deliberately the same grain, so
 * one job, one watermark and one read pattern cover both. Minute rather than
 * hour was chosen on a measurement, not symmetry: hour grain would be six times
 * smaller (850 rows/hour against 5,344) but leaves a raw tail of up to an hour
 * — ~114,000 events to scan on every read against ~1,900 at minute grain. Short
 * ranges are the common case and that is where the tail dominates.
 *
 * One row per `(project, minute, template)`, which unlike `event_rollup_minutes`
 * really is a row per dimension value. It is affordable here precisely because
 * the dimension is bounded by the *application's* vocabulary rather than by
 * traffic: 5,344 rows an hour is ~3.85M a month, about 385 MB, against an
 * `events` table heading for 38 GB.
 *
 * **That bound is the whole point.** Reading `topMessages` today scales with
 * the number of events; reading it from here scales with the number of *kinds*
 * of message, which does not grow when traffic does.
 */
export const eventTemplateRollup = pgTable(
    "event_template_rollup",
    {
        projectId: uuid("project_id")
            .notNull()
            .references(() => projects.id, { onDelete: "cascade" }),
        /** Start of the minute, `date_trunc('minute', timestamp)`. */
        minute: timestamp("minute", { withTimezone: true }).notNull(),
        templateHash: bigint("template_hash", { mode: "bigint" }).notNull(),
        count: integer("count").notNull(),
        /**
         * `{"info": 412, "error": 7}` — counts per level for this template in
         * this minute, the same shape `event_rollup_minutes.by_level` uses.
         *
         * Counts rather than a single "most severe level" column, which is what
         * this was for about ten minutes. A severity column is narrower and
         * answers a *different question*: `pickDominantLevel` badges a template
         * with its most **frequent** level, breaking ties toward severity, so a
         * template with a hundred `info` and one `error` reads `info`. Storing
         * only the maximum would silently change that to `error` and no test
         * would have caught it, because the tested function would still be
         * correct while nothing called it with real numbers any more.
         */
        byLevel: jsonb("by_level").notNull().default(sql`'{}'::jsonb`),
        /** Latest event timestamp in the bucket, for the "last seen" column. */
        latestAt: timestamp("latest_at", { withTimezone: true }).notNull(),
        /**
         * `by_level` unpacked into one column per level, **generated**, so the
         * job still writes only the JSON and the two cannot drift. Exactly the
         * arrangement `event_rollup_minutes.errors` already uses, and for the
         * same reason.
         *
         * Added 2026-08-24 on a measurement. Reading the JSON meant
         * `FROM event_template_rollup r, jsonb_each_text(r.by_level) l`, which
         * multiplies every row by up to five and parses JSON per row; the
         * widget it feeds measured **547 ms at 0% I/O** — entirely CPU, so no
         * amount of memory would have helped it. Summing five `int` columns
         * needs no lateral, no parse and no row multiplication.
         *
         * The jsonb stays rather than being replaced: it is what the job
         * writes, dropping it would mean a backfill, and it remains the honest
         * shape for "counts per level" if a sixth level ever appears — these
         * columns would then need a migration, which is the right amount of
         * friction for changing a closed set.
         *
         * Five columns is affordable **because `level` is a closed set of
         * five** — the one dimension in the inventory that cannot grow. The
         * same treatment applied to `by_env` or `by_source` would be exactly
         * the unbounded-column mistake those are jsonb to avoid.
         */
        nDebug: integer("n_debug").generatedAlwaysAs(sql`COALESCE((by_level->>'debug')::int, 0)`),
        nInfo: integer("n_info").generatedAlwaysAs(sql`COALESCE((by_level->>'info')::int, 0)`),
        nWarn: integer("n_warn").generatedAlwaysAs(sql`COALESCE((by_level->>'warn')::int, 0)`),
        nError: integer("n_error").generatedAlwaysAs(sql`COALESCE((by_level->>'error')::int, 0)`),
        nFatal: integer("n_fatal").generatedAlwaysAs(sql`COALESCE((by_level->>'fatal')::int, 0)`),
    },
    (t) => ({
        pk: primaryKey({ columns: [t.projectId, t.minute, t.templateHash] }),
        /**
         * The read is "sum counts for one project across a minute range", which
         * the primary key already leads on. This covers the other direction —
         * one template's history — which the drill-down needs.
         */
        templateHistoryIdx: index("event_template_rollup_template_idx").on(
            t.projectId,
            t.templateHash,
            t.minute,
        ),
    }),
);

export type MessageTemplate = typeof messageTemplates.$inferSelect;
export type EventTemplateRollup = typeof eventTemplateRollup.$inferSelect;
