import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/core/db/client";
import { alertRules, alertNotifications, projects } from "@/core/db/schema";
import type { AlertRule, AlertNotification } from "@/core/db/schema";
import { assertPermission } from "@/shared/permissions/guards";
import type { Membership } from "@/shared/permissions/check";
import type { CreateAlertRuleInput, UpdateAlertRuleInput } from "@/features/alerts/utils/alert-schemas";

export type { AlertRule };

export async function listAlertRules(
    projectId: string,
    membership: Membership,
    includeDisabled = false,
): Promise<AlertRule[]> {
    assertPermission(membership, "alerts.read");

    const conditions = [eq(alertRules.projectId, projectId)];
    if (!includeDisabled) {
        conditions.push(eq(alertRules.enabled, true));
    }

    return db.select().from(alertRules).where(and(...conditions)).orderBy(desc(alertRules.createdAt));
}

export async function getAlertRule(
    projectId: string,
    ruleId: string,
    membership: Membership,
): Promise<AlertRule | null> {
    assertPermission(membership, "alerts.read");

    const rows = await db
        .select()
        .from(alertRules)
        .where(and(eq(alertRules.id, ruleId), eq(alertRules.projectId, projectId)))
        .limit(1);

    return rows[0] ?? null;
}

export async function createAlertRule(
    projectId: string,
    input: CreateAlertRuleInput,
    createdBy: string,
    membership: Membership,
): Promise<AlertRule> {
    assertPermission(membership, "alerts.manage");

    const rows = await db
        .insert(alertRules)
        .values({
            projectId,
            name: input.name,
            description: input.description,
            filter: input.filter,
            condition: input.condition,
            channels: input.channels,
            notifyOnResolve: input.notifyOnResolve ?? true,
            createdBy,
            version: 1,
        })
        .returning();

    return rows[0]!;
}

export async function updateAlertRule(
    projectId: string,
    input: UpdateAlertRuleInput,
    membership: Membership,
): Promise<AlertRule> {
    assertPermission(membership, "alerts.manage");

    const patch: Partial<typeof alertRules.$inferInsert> = {
        updatedAt: new Date(),
    };

    if (input.name !== undefined) patch.name = input.name;
    if (input.description !== undefined) patch.description = input.description;
    if (input.notifyOnResolve !== undefined) patch.notifyOnResolve = input.notifyOnResolve;

    if (input.filter !== undefined || input.condition !== undefined || input.channels !== undefined) {
        if (input.filter !== undefined) patch.filter = input.filter;
        if (input.condition !== undefined) patch.condition = input.condition;
        if (input.channels !== undefined) patch.channels = input.channels;
        // Reset state when filter/condition changes to avoid stale firing
        patch.state = "ok";
        patch.stateChangedAt = new Date();
    }

    const rows = await db
        .update(alertRules)
        .set({ ...patch, version: sql`${alertRules.version} + 1` })
        .where(and(eq(alertRules.id, input.id), eq(alertRules.projectId, projectId)))
        .returning();

    if (!rows[0]) {
        throw new Error(`Alert rule ${input.id} not found`);
    }

    return rows[0]!;
}

export async function deleteAlertRule(
    projectId: string,
    ruleId: string,
    membership: Membership,
): Promise<void> {
    assertPermission(membership, "alerts.manage");

    await db
        .delete(alertRules)
        .where(and(eq(alertRules.id, ruleId), eq(alertRules.projectId, projectId)));
}

export async function toggleAlertRule(
    projectId: string,
    ruleId: string,
    enabled: boolean,
    membership: Membership,
): Promise<AlertRule> {
    assertPermission(membership, "alerts.manage");

    const patch: Partial<typeof alertRules.$inferInsert> = {
        enabled,
        updatedAt: new Date(),
    };

    // Reset state when disabling a firing rule to avoid spurious resolve on re-enable
    if (!enabled) {
        patch.state = "ok";
        patch.stateChangedAt = new Date();
    }

    const rows = await db
        .update(alertRules)
        .set(patch)
        .where(and(eq(alertRules.id, ruleId), eq(alertRules.projectId, projectId)))
        .returning();

    if (!rows[0]) {
        throw new Error(`Alert rule ${ruleId} not found`);
    }

    return rows[0]!;
}

export async function listEnabled(): Promise<AlertRule[]> {
    return db
        .select({ alertRules })
        .from(alertRules)
        .innerJoin(projects, eq(alertRules.projectId, projects.id))
        .where(and(eq(alertRules.enabled, true), isNull(projects.deletedAt)))
        .then((rows) => rows.map((r) => r.alertRules));
}

const HISTORY_PAGE_SIZE = 50;

export async function listAlertHistory(
    ruleId: string,
    projectId: string,
    membership: Membership,
    page = 0,
): Promise<{ notifications: AlertNotification[]; total: number }> {
    assertPermission(membership, "alerts.read");

    const rule = await getAlertRule(projectId, ruleId, membership);
    if (!rule) throw new Error(`Alert rule ${ruleId} not found`);

    const [notifications, countRows] = await Promise.all([
        db
            .select()
            .from(alertNotifications)
            .where(eq(alertNotifications.alertRuleId, ruleId))
            .orderBy(desc(alertNotifications.triggeredAt))
            .limit(HISTORY_PAGE_SIZE)
            .offset(page * HISTORY_PAGE_SIZE),
        db.$count(alertNotifications, eq(alertNotifications.alertRuleId, ruleId)),
    ]);

    return { notifications, total: Number(countRows) };
}
