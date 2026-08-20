CREATE TABLE "event_rollup_minutes" (
	"project_id" uuid NOT NULL,
	"minute" timestamp with time zone NOT NULL,
	"total" integer NOT NULL,
	"by_level" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"by_env" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"errors" integer GENERATED ALWAYS AS (COALESCE((by_level->>'error')::int, 0) + COALESCE((by_level->>'fatal')::int, 0)) STORED,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_rollup_minutes_project_id_minute_pk" PRIMARY KEY("project_id","minute")
);
--> statement-breakpoint
CREATE TABLE "rollup_state" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"refresh_from" timestamp with time zone DEFAULT now() NOT NULL,
	"rolled_up_to" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "event_rollup_minutes" ADD CONSTRAINT "event_rollup_minutes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rollup_state" ADD CONSTRAINT "rollup_state_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Seed the watermark so the first job run builds the rollup from the oldest
-- event forward. The build itself deliberately happens in the background job,
-- not here: a migration that aggregates the whole events table would make
-- deployment time proportional to data volume, and a failure mid-way would
-- block the release rather than retry on its own.
--
-- `rolled_up_to` stays NULL, which readers treat as "nothing is rolled up yet"
-- and answer entirely from `events`. That is what makes this migration safe to
-- deploy ahead of the first successful job run.
INSERT INTO "rollup_state" ("project_id", "refresh_from")
SELECT p.id, COALESCE((SELECT MIN(e.timestamp) FROM "events" e WHERE e.project_id = p.id), now())
FROM "projects" p
ON CONFLICT ("project_id") DO NOTHING;
