import { index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

import { projects } from "./projects";

/**
 * Which environments a project has sent events from, maintained at ingest.
 *
 * Exists to answer the overview's environment dropdown without scanning
 * `events`. That scan was measured at **13.4% of the org overview's total
 * database time** with `pg_stat_statements` on 2026-08-20 — 30 days of events
 * read on every page load to produce a list of two values. See
 * `PLAN.md` §16.1 Stage D.
 *
 * Modelled on `attribute_key_types`, which already maintains a per-project
 * registry from the ingest path.
 *
 * Two schema notes:
 *
 * - `environment` is **nullable**, because an event may carry none, and that
 *   absence is itself one of the options the dropdown offers (as "(unset)").
 *   A nullable column cannot take part in a primary key, so uniqueness is a
 *   `UNIQUE ... NULLS NOT DISTINCT` constraint instead — without
 *   `NULLS NOT DISTINCT`, Postgres treats every NULL as unique and the table
 *   would accumulate one "no environment" row per ingest request.
 * - `lastSeenAt` is what keeps a decommissioned environment from lingering in
 *   the dropdown forever. The query it replaces looked back 30 days over
 *   `events`; this column reproduces that without the scan.
 */
export const projectEnvironments = pgTable(
    "project_environments",
    {
        projectId: uuid("project_id")
            .notNull()
            .references(() => projects.id, { onDelete: "cascade" }),
        environment: text("environment"),
        firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
        lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => ({
        projectEnvUnique: unique("project_environments_project_env_unique")
            .on(t.projectId, t.environment)
            .nullsNotDistinct(),
        lastSeenIdx: index("project_environments_last_seen_idx").on(t.projectId, t.lastSeenAt),
    }),
);

export type ProjectEnvironment = typeof projectEnvironments.$inferSelect;
export type NewProjectEnvironment = typeof projectEnvironments.$inferInsert;
