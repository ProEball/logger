import {
    boolean,
    index,
    integer,
    jsonb,
    pgTable,
    text,
    timestamp,
    uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { projects } from "./projects";
import { users } from "./auth";

export const alertRules = pgTable(
    "alert_rules",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        projectId: uuid("project_id")
            .notNull()
            .references(() => projects.id, { onDelete: "cascade" }),
        name: text("name").notNull(),
        description: text("description"),
        filter: jsonb("filter").notNull(),
        condition: jsonb("condition").notNull(),
        channels: jsonb("channels").notNull(),
        state: text("state").notNull().default("ok"),
        stateChangedAt: timestamp("state_changed_at", { withTimezone: true }),
        lastEvaluatedAt: timestamp("last_evaluated_at", { withTimezone: true }),
        lastMatchCount: integer("last_match_count"),
        enabled: boolean("enabled").notNull().default(true),
        notifyOnResolve: boolean("notify_on_resolve").notNull().default(true),
        createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
        version: integer("version").notNull().default(1),
    },
    (t) => ({
        projectEnabledIdx: index("alert_rules_project_enabled_idx")
            .on(t.projectId)
            .where(sql`${t.enabled} = true`),
    }),
);

export const alertNotifications = pgTable(
    "alert_notifications",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        alertRuleId: uuid("alert_rule_id")
            .notNull()
            .references(() => alertRules.id, { onDelete: "cascade" }),
        triggeredAt: timestamp("triggered_at", { withTimezone: true }).notNull(),
        state: text("state").notNull(),
        payload: jsonb("payload"),
        channelType: text("channel_type"),
        channelTarget: text("channel_target"),
        deliveryStatus: text("delivery_status").notNull().default("pending"),
        deliveryAttempts: integer("delivery_attempts").notNull().default(0),
        deliveryLastError: text("delivery_last_error"),
        deliveryHttpStatus: integer("delivery_http_status"),
        deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    },
    (t) => ({
        ruleTriggeredIdx: index("alert_notifications_rule_triggered_idx").on(
            t.alertRuleId,
            t.triggeredAt,
        ),
    }),
);

export type AlertRule = typeof alertRules.$inferSelect;
export type NewAlertRule = typeof alertRules.$inferInsert;
export type AlertNotification = typeof alertNotifications.$inferSelect;
export type NewAlertNotification = typeof alertNotifications.$inferInsert;
