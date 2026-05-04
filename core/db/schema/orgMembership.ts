import {
    boolean,
    index,
    pgTable,
    primaryKey,
    text,
    timestamp,
    uuid,
} from "drizzle-orm/pg-core";

import { users } from "./auth";
import { organizations, roles } from "./organizations";

export const organizationMembers = pgTable(
    "organization_members",
    {
        organizationId: uuid("organization_id")
            .notNull()
            .references(() => organizations.id, { onDelete: "cascade" }),
        userId: text("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        roleId: uuid("role_id")
            .notNull()
            .references(() => roles.id, { onDelete: "restrict" }),
        isOwner: boolean("is_owner").notNull().default(false),
        joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => ({
        pk: primaryKey({ columns: [t.organizationId, t.userId] }),
        userIdIdx: index("org_members_user_id_idx").on(t.userId),
    }),
);

// Placeholder table — FK to projects.id is added in feature 02
export const projectMemberRoles = pgTable(
    "project_member_roles",
    {
        projectId: uuid("project_id").notNull(),
        userId: text("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        roleId: uuid("role_id")
            .notNull()
            .references(() => roles.id, { onDelete: "restrict" }),
    },
    (t) => ({
        pk: primaryKey({ columns: [t.projectId, t.userId] }),
    }),
);
