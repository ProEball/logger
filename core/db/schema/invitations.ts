import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { users } from "./auth";
import { organizations, roles } from "./organizations";

export const invitations = pgTable(
    "invitations",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        organizationId: uuid("organization_id")
            .notNull()
            .references(() => organizations.id, { onDelete: "cascade" }),
        email: text("email").notNull(),
        roleId: uuid("role_id")
            .notNull()
            .references(() => roles.id, { onDelete: "restrict" }),
        token: text("token").notNull().unique(),
        expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
        invitedBy: text("invited_by").references(() => users.id, { onDelete: "set null" }),
        acceptedAt: timestamp("accepted_at", { withTimezone: true }),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => ({
        // Partial index: only pending (unaccepted) invitations need fast lookup
        emailOrgPendingIdx: index("invitations_email_org_pending_idx")
            .on(t.email, t.organizationId)
            .where(sql`${t.acceptedAt} IS NULL`),
    }),
);
