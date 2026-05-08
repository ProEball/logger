-- Migration: 0003_events_partitioned
-- Hand-edited: Drizzle DSL does not support PARTITION BY RANGE.
-- This migration is idempotent — safe to re-run.
-- Note: pg_partman installed into public schema (not partman schema).

-- ── 1. Events parent table (partitioned) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS "events" (
    "id"            uuid          NOT NULL,
    "project_id"    uuid          NOT NULL,
    "timestamp"     timestamptz   NOT NULL,
    "level"         text          NOT NULL,
    "message"       text          NOT NULL,
    "source"        text,
    "environment"   text,
    "release"       text,
    "user_id"       text,
    "session_id"    text,
    "request_id"    text,
    "trace_id"      text,
    "error_type"    text,
    "stack_trace"   text,
    "attributes"    jsonb         DEFAULT '{}'::jsonb,
    "context"       jsonb         DEFAULT '{}'::jsonb,
    "user_agent"    text,
    "ip"            text,
    PRIMARY KEY ("project_id", "timestamp", "id")
) PARTITION BY RANGE ("timestamp");
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'events_project_id_projects_id_fk'
          AND table_name = 'events'
    ) THEN
        ALTER TABLE "events"
            ADD CONSTRAINT "events_project_id_projects_id_fk"
            FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT;
    END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_project_timestamp_idx"
    ON "events" ("project_id", "timestamp" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_project_level_timestamp_idx"
    ON "events" ("project_id", "level", "timestamp" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_project_error_type_idx"
    ON "events" ("project_id", "error_type", "timestamp" DESC)
    WHERE "error_type" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_attributes_gin_idx"
    ON "events" USING GIN ("attributes");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_message_fts_idx"
    ON "events" USING GIN (to_tsvector('simple', "message"));
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.part_config
        WHERE parent_table = 'public.events'
    ) THEN
        PERFORM public.create_parent(
            p_parent_table := 'public.events',
            p_control      := 'timestamp',
            p_interval     := '1 day',
            p_premake      := 7
        );
    END IF;
END $$;
--> statement-breakpoint
UPDATE public.part_config
SET retention                = '30 days',
    retention_keep_table     = false,
    retention_keep_index     = false,
    infinite_time_partitions = true
WHERE parent_table = 'public.events';
