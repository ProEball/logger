import { and, count, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { type PgBoss } from "pg-boss";
import { db } from "@/core/db/client";
import { alertRules, alertNotifications, events } from "@/core/db/schema";
import type { AlertRule } from "@/core/db/schema";
import type { AlertCondition } from "@/features/alerts/utils/alert-schemas";
import type { EventFilters } from "@/shared/utils/event-filters.schema";
import { listEnabled } from "./alert-rules.service";

const EVALUATOR_CONCURRENCY = 10;

type AlertState = "ok" | "firing";

function resolveWindowBoundary(windowMinutes: number): Date {
    return new Date(Date.now() - windowMinutes * 60 * 1000);
}

async function countMatchingEvents(
    projectId: string,
    filter: EventFilters,
    condition: AlertCondition,
): Promise<number> {
    const windowFrom = resolveWindowBoundary(condition.windowMinutes);
    const now = new Date();

    const conditions = [
        eq(events.projectId, projectId),
        gte(events.timestamp, windowFrom),
        lt(events.timestamp, now),
    ];

    if (filter.levels?.length) {
        conditions.push(inArray(events.level, filter.levels));
    }
    if (filter.environments?.length) {
        conditions.push(inArray(events.environment, filter.environments as [string, ...string[]]));
    }
    if (filter.sources?.length) {
        conditions.push(inArray(events.source, filter.sources as [string, ...string[]]));
    }
    if (filter.releases?.length) {
        conditions.push(inArray(events.release, filter.releases as [string, ...string[]]));
    }
    if (filter.errorTypes?.length) {
        conditions.push(inArray(events.errorType, filter.errorTypes as [string, ...string[]]));
    }
    if (filter.userId) conditions.push(eq(events.userId, filter.userId));
    if (filter.sessionId) conditions.push(eq(events.sessionId, filter.sessionId));
    if (filter.requestId) conditions.push(eq(events.requestId, filter.requestId));
    if (filter.traceId) conditions.push(eq(events.traceId, filter.traceId));
    if (filter.message) {
        conditions.push(
            sql`to_tsvector('simple', ${events.message}) @@ websearch_to_tsquery('simple', ${filter.message})`,
        );
    }
    if (filter.attributes?.length) {
        for (const { key, value } of filter.attributes) {
            conditions.push(sql`${events.attributes} @> ${JSON.stringify({ [key]: value })}::jsonb`);
        }
    }

    const [row] = await db.select({ n: count() }).from(events).where(and(...conditions));
    return Number(row?.n ?? 0);
}

export async function evaluateOne(rule: AlertRule, boss: PgBoss): Promise<void> {
    const capturedVersion = rule.version;
    const condition = rule.condition as AlertCondition;
    const filter = rule.filter as EventFilters;

    const matchCount = await countMatchingEvents(rule.projectId, filter, condition);
    const newState: AlertState = matchCount >= condition.count ? "firing" : "ok";
    const currentState = rule.state as AlertState;
    const now = new Date();

    if (newState === currentState) {
        // No transition — just update metrics with optimistic concurrency guard.
        // If 0 rows match (rule edited mid-tick), the update is a no-op; next tick picks it up.
        await db
            .update(alertRules)
            .set({ lastEvaluatedAt: now, lastMatchCount: matchCount })
            .where(and(eq(alertRules.id, rule.id), eq(alertRules.version, capturedVersion)));
        return;
    }

    // State transition
    const [updated] = await db
        .update(alertRules)
        .set({
            state: newState,
            stateChangedAt: now,
            lastEvaluatedAt: now,
            lastMatchCount: matchCount,
            version: sql`${alertRules.version} + 1`,
        })
        .where(and(eq(alertRules.id, rule.id), eq(alertRules.version, capturedVersion)))
        .returning();

    if (!updated) {
        // Optimistic concurrency miss — skip, next tick picks up the new version
        return;
    }

    const shouldNotify = newState === "firing" || rule.notifyOnResolve;
    if (!shouldNotify) return;

    const [notification] = await db
        .insert(alertNotifications)
        .values({
            alertRuleId: rule.id,
            triggeredAt: now,
            state: newState,
            channelType: "webhook",
            channelTarget: (rule.channels as Array<{ url: string }>)[0]?.url ?? "",
            deliveryStatus: "pending",
        })
        .returning();

    if (!notification) return;

    // Enqueue delivery job for every channel
    const channels = rule.channels as Array<{ type: string; url: string }>;
    for (const channel of channels) {
        if (channel.type !== "webhook") continue;
        await boss.send("alert-delivery", {
            notificationId: notification.id,
            ruleId: rule.id,
            channelUrl: channel.url,
            channelHeaders: (channel as { headers?: Array<{ key: string; value: string }> }).headers ?? [],
        }, {
            retryLimit: 3,
            retryDelay: 30,
            retryBackoff: true,
        });
    }
}

export async function evaluateAllEnabled(boss: PgBoss): Promise<void> {
    const rules = await listEnabled();
    const chunks: AlertRule[][] = [];

    for (let i = 0; i < rules.length; i += EVALUATOR_CONCURRENCY) {
        chunks.push(rules.slice(i, i + EVALUATOR_CONCURRENCY));
    }

    for (const chunk of chunks) {
        await Promise.all(
            chunk.map((rule) =>
                evaluateOne(rule, boss).catch((err) => {
                    console.error(`[alert-evaluator] rule ${rule.id} failed:`, err);
                }),
            ),
        );
    }
}
