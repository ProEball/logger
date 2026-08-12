import { pgTable, uuid, text, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { projects } from "./projects";

// Records the first-seen JSON type ("string" | "number" | "boolean") for each
// event.attributes key, per project. Enforced at ingest time so a key can't
// silently drift types, which would break `attributes @> {...}::jsonb` filters.
export const attributeKeyTypes = pgTable(
    "attribute_key_types",
    {
        projectId: uuid("project_id")
            .notNull()
            .references(() => projects.id, { onDelete: "cascade" }),
        key: text("key").notNull(),
        type: text("type").notNull(),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => ({
        pk: primaryKey({ columns: [t.projectId, t.key] }),
    }),
);

export type AttributeKeyType = typeof attributeKeyTypes.$inferSelect;
export type NewAttributeKeyType = typeof attributeKeyTypes.$inferInsert;
