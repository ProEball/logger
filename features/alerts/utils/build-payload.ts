import { and, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { db } from "@/core/db/client";
import { events } from "@/core/db/schema";
import type { AlertRule } from "@/core/db/schema";
import type { AlertCondition } from "@/features/alerts/utils/alert-schemas";
import type { EventFilters } from "@/shared/utils/event-filters.schema";
import { serializeFilters } from "@/shared/utils/serialize-filters";

const SAMPLE_EVENT_LIMIT = 3;

type SampleEvent = {
    id: string;
    timestamp: string;
    level: string;
    message: string;
    error_type: string | null;
    source: string | null;
};

export type AlertPayload = {
    rule_id: string;
    rule_name: string;
    project_id: string;
    state: string;
    previous_state: string;
    triggered_at: string;
    condition: {
        type: string;
        count: number;
        threshold: number;
        windowMinutes: number;
    };
    filter: Record<string, unknown>;
    sample_events: SampleEvent[];
    events_url: string;
    test: boolean;
};

export async function buildPayload(
    rule: AlertRule,
    newState: string,
    previousState: string,
    triggeredAt: Date,
    orgSlug: string,
    projectSlug: string,
    isTest = false,
): Promise<AlertPayload> {
    const condition = rule.condition as AlertCondition;
    const filter = rule.filter as EventFilters;

    const sampleEvents = isTest
        ? buildTestSampleEvents()
        : await fetchSampleEvents(rule.projectId, filter, condition);

    const filterParams = serializeFilters(filter);
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const eventsUrl = `${baseUrl}/${orgSlug}/${projectSlug}/events?${filterParams.toString()}`;

    return {
        rule_id: rule.id,
        rule_name: rule.name,
        project_id: rule.projectId,
        state: newState,
        previous_state: previousState,
        triggered_at: triggeredAt.toISOString(),
        condition: {
            type: condition.type,
            count: condition.count,
            threshold: condition.count,
            windowMinutes: condition.windowMinutes,
        },
        filter: rule.filter as Record<string, unknown>,
        sample_events: sampleEvents,
        events_url: eventsUrl,
        test: isTest,
    };
}

async function fetchSampleEvents(
    projectId: string,
    filter: EventFilters,
    condition: AlertCondition,
): Promise<SampleEvent[]> {
    const windowFrom = new Date(Date.now() - condition.windowMinutes * 60 * 1000);
    const now = new Date();

    const conditions = [
        eq(events.projectId, projectId),
        gte(events.timestamp, windowFrom),
        lt(events.timestamp, now),
    ];

    if (filter.levels?.length) {
        conditions.push(inArray(events.level, filter.levels));
    }

    const rows = await db
        .select({
            id: events.id,
            timestamp: events.timestamp,
            level: events.level,
            message: events.message,
            error_type: events.errorType,
            source: events.source,
        })
        .from(events)
        .where(and(...conditions))
        .orderBy(desc(events.timestamp))
        .limit(SAMPLE_EVENT_LIMIT);

    return rows.map((r) => ({
        id: r.id,
        timestamp: r.timestamp.toISOString(),
        level: r.level,
        message: r.message,
        error_type: r.error_type,
        source: r.source,
    }));
}

function buildTestSampleEvents(): SampleEvent[] {
    return [
        {
            id: "00000000-0000-0000-0000-000000000001",
            timestamp: new Date().toISOString(),
            level: "error",
            message: "Test event — this is a sample from the test fire",
            error_type: "TestError",
            source: "test",
        },
    ];
}
