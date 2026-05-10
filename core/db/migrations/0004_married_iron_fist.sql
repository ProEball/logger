CREATE TABLE "alert_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"alert_rule_id" uuid NOT NULL,
	"triggered_at" timestamp with time zone NOT NULL,
	"state" text NOT NULL,
	"payload" jsonb,
	"channel_type" text,
	"channel_target" text,
	"delivery_status" text DEFAULT 'pending' NOT NULL,
	"delivery_attempts" integer DEFAULT 0 NOT NULL,
	"delivery_last_error" text,
	"delivery_http_status" integer,
	"delivered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "alert_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"filter" jsonb NOT NULL,
	"condition" jsonb NOT NULL,
	"channels" jsonb NOT NULL,
	"state" text DEFAULT 'ok' NOT NULL,
	"state_changed_at" timestamp with time zone,
	"last_evaluated_at" timestamp with time zone,
	"last_match_count" integer,
	"enabled" boolean DEFAULT true NOT NULL,
	"notify_on_resolve" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alert_notifications" ADD CONSTRAINT "alert_notifications_alert_rule_id_alert_rules_id_fk" FOREIGN KEY ("alert_rule_id") REFERENCES "public"."alert_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alert_notifications_rule_triggered_idx" ON "alert_notifications" USING btree ("alert_rule_id","triggered_at");--> statement-breakpoint
CREATE INDEX "alert_rules_project_enabled_idx" ON "alert_rules" USING btree ("project_id") WHERE "alert_rules"."enabled" = true;