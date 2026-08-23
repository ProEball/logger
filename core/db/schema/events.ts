import { bigint, pgTable, uuid, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { projects } from "./projects";

// NOTE: This table uses PARTITION BY RANGE(timestamp).
// Drizzle DSL cannot express partitioning — the parent table is created via raw SQL
// in migration 0003_events_partitioned.sql. This schema definition is used only for
// type-safe query building (insert, select). The actual DDL is in the migration file.
export const events = pgTable(
    "events",
    {
        id: uuid("id").notNull(),
        projectId: uuid("project_id")
            .notNull()
            .references(() => projects.id, { onDelete: "restrict" }),
        timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
        level: text("level").notNull(),
        message: text("message").notNull(),
        source: text("source"),
        environment: text("environment"),
        release: text("release"),
        userId: text("user_id"),
        sessionId: text("session_id"),
        requestId: text("request_id"),
        traceId: text("trace_id"),
        errorType: text("error_type"),
        stackTrace: text("stack_trace"),
        attributes: jsonb("attributes").default(sql`'{}'::jsonb`),
        context: jsonb("context").default(sql`'{}'::jsonb`),
        userAgent: text("user_agent"),
        ip: text("ip"),
        /**
         * Fingerprint of the message template, computed at ingest by
         * `templateHashForStorage`. Nullable, and permanently so: every event
         * ingested before this column existed has none, and there is no way to
         * derive one in SQL — the normaliser is TypeScript, and a second
         * implementation in a different regex engine is exactly the drift this
         * repository keeps paying for.
         *
         * Read by the rollup job and by the raw tail above the watermark. The
         * tail only ever covers the newest minute, which is always after this
         * column shipped, so the NULLs are confined to history.
         */
        templateHash: bigint("template_hash", { mode: "bigint" }),
    },
    (t) => ({
        // Composite PK is defined in raw SQL migration (partitioned tables require partition key in PK)
        // These indexes are defined here for Drizzle awareness but also created via raw SQL in migration
        projectTimestampIdx: index("events_project_timestamp_idx").on(t.projectId, t.timestamp),
        projectLevelTimestampIdx: index("events_project_level_timestamp_idx").on(t.projectId, t.level, t.timestamp),
        projectErrorTypeIdx: index("events_project_error_type_idx")
            .on(t.projectId, t.errorType, t.timestamp)
            .where(sql`${t.errorType} IS NOT NULL`),
    }),
);

export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
