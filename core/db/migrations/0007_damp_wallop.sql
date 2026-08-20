CREATE TABLE "project_environments" (
	"project_id" uuid NOT NULL,
	"environment" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_environments_project_env_unique" UNIQUE NULLS NOT DISTINCT("project_id","environment")
);
--> statement-breakpoint
ALTER TABLE "project_environments" ADD CONSTRAINT "project_environments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_environments_last_seen_idx" ON "project_environments" USING btree ("project_id","last_seen_at");--> statement-breakpoint
-- Backfill from the events already in the table.
--
-- Without this an existing install loses its environment dropdown until fresh
-- events arrive for every environment it had — the registry is maintained at
-- ingest, so it starts empty and knows nothing about history.
--
-- This reads every row of `events` once. It is a one-time cost paid during
-- migration, and it is proportional to the table: on the 2M-row staging
-- database expect this statement to dominate the migration's runtime.
INSERT INTO "project_environments" ("project_id", "environment", "first_seen_at", "last_seen_at")
SELECT project_id, environment, MIN(timestamp), MAX(timestamp)
FROM "events"
GROUP BY project_id, environment
ON CONFLICT ON CONSTRAINT "project_environments_project_env_unique" DO NOTHING;
