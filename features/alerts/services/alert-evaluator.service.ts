import { and, eq, sql } from "drizzle-orm";
import { type PgBoss } from "pg-boss";
import { db } from "@/core/db/client";
import { alertRules, alertNotifications } from "@/core/db/schema";
import type { AlertRule } from "@/core/db/schema";
import { clickhouse } from "@/core/clickhouse/client";
import { EVENTS_TABLE } from "@/core/clickhouse/tables";
import { compileFilters } from "@/core/clickhouse/filter-compiler";
import type { AlertCondition } from "@/features/alerts/utils/alert-schemas";
import type { EventFilters } from "@/shared/utils/event-filters.schema";
import { listEnabled } from "./alert-rules.service";

const EVALUATOR_CONCURRENCY = 10;

type AlertState = "ok" | "firing";

function resolveWindowBoundary(windowMinutes: number): Date {
    return new Date(Date.now() - windowMinutes * 60 * 1000);
}

/**
 * How many events in the rule's window match its filter.
 *
 * **The filter is compiled, not rebuilt here.** Until Phase 3 this function
 * held its own copy of the events page's `buildConditions` — the same eleven
 * fields, written twice, with no test comparing them, and nothing to stop a
 * twelfth field being added to one of them. Both are now
 * `core/clickhouse/filter-compiler.ts`.
 *
 * Soft-deleted projects are still excluded, but upstream rather than here:
 * `listEnabled` joins `projects` and drops their rules before this is reached.
 *
 * The window comes from the rule's condition and has nothing to do with the
 * `range` stored on `filter`, which is why `compileFilters` takes the window as
 * a parameter. `toExclusive` preserves this function's original half-open
 * boundary exactly.
 */
async function countMatchingEvents(
    projectId: string,
    filter: EventFilters,
    condition: AlertCondition,
): Promise<number> {
    const { where, params } = compileFilters(projectId, filter, {
        from: resolveWindowBoundary(condition.windowMinutes),
        to: new Date(),
        toExclusive: true,
    });

    const result = await clickhouse.query({
        query: `SELECT count() AS n FROM ${EVENTS_TABLE} WHERE ${where}`,
        query_params: params,
        format: "JSONEachRow",
    });

    // `count()` is a UInt64 and arrives as a decimal string.
    const [row] = await result.json<{ n: string }>();
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
