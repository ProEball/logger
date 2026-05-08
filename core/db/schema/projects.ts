import {
    index,
    integer,
    pgTable,
    text,
    timestamp,
    uniqueIndex,
    uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { organizations } from "./organizations";
import { users } from "./auth";

export const projects = pgTable(
    "projects",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        organizationId: uuid("organization_id")
            .notNull()
            .references(() => organizations.id, { onDelete: "cascade" }),
        name: text("name").notNull(),
        slug: text("slug").notNull(),
        retentionDays: integer("retention_days").notNull().default(30),
        deletedAt: timestamp("deleted_at", { withTimezone: true }),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => ({
        orgSlugUnique: uniqueIndex("projects_org_slug_unique")
            .on(t.organizationId, t.slug)
            .where(sql`${t.deletedAt} IS NULL`),
        orgActiveIdx: index("projects_org_active_idx")
            .on(t.organizationId)
            .where(sql`${t.deletedAt} IS NULL`),
    }),
);

export const apiKeys = pgTable(
    "api_keys",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        projectId: uuid("project_id")
            .notNull()
            .references(() => projects.id, { onDelete: "cascade" }),
        name: text("name").notNull(),
        keyHash: text("key_hash").notNull().unique(),
        keyPrefix: text("key_prefix").notNull(),
        lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
        revokedAt: timestamp("revoked_at", { withTimezone: true }),
        createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => ({
        projectActiveIdx: index("api_keys_project_active_idx")
            .on(t.projectId)
            .where(sql`${t.revokedAt} IS NULL`),
    }),
);
