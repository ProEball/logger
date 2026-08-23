CREATE TABLE "event_template_rollup" (
	"project_id" uuid NOT NULL,
	"minute" timestamp with time zone NOT NULL,
	"template_hash" bigint NOT NULL,
	"count" integer NOT NULL,
	"by_level" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"latest_at" timestamp with time zone NOT NULL,
	CONSTRAINT "event_template_rollup_project_id_minute_template_hash_pk" PRIMARY KEY("project_id","minute","template_hash")
);
--> statement-breakpoint
CREATE TABLE "message_templates" (
	"project_id" uuid NOT NULL,
	"template_hash" bigint NOT NULL,
	"template" text NOT NULL,
	"normalizer_version" integer NOT NULL,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_templates_project_id_template_hash_pk" PRIMARY KEY("project_id","template_hash")
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "template_hash" bigint;--> statement-breakpoint
ALTER TABLE "rollup_state" ADD COLUMN "templates_rolled_up_to" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "event_template_rollup" ADD CONSTRAINT "event_template_rollup_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_template_rollup_template_idx" ON "event_template_rollup" USING btree ("project_id","template_hash","minute");