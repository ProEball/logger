import { env } from "@/core/env";
import { clickhouse } from "@/core/clickhouse/client";
import { EVENTS_TABLE } from "@/core/clickhouse/tables";
import { compileFilters } from "@/core/clickhouse/filter-compiler";
import type { AlertRule } from "@/core/db/schema";
import type { AlertCondition } from "@/features/alerts/utils/alert-schemas";
import type { EventFilters } from "@/shared/utils/event-filters.schema";
import { serializeFilters } from "@/shared/utils/serialize-filters";

const SAMPLE_EVENT_LIMIT = 3;

export type SampleEvent = {
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
    // Mirrors the stored `condition` shape exactly (see alert-schemas.ts) so an
    // integrator reads one shape in the rule and the same one in the webhook.
    // A `threshold` alias of `count` used to be emitted here as well; it was
    // undocumented, had no consumer, and was removed 2026-08-19 while the
    // install was still pre-launch and dropping it broke nothing.
    condition: {
        type: string;
        count: number;
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
    const eventsUrl = `${env.APP_URL}/${orgSlug}/${projectSlug}/events?${filterParams.toString()}`;

    return assembleAlertPayload({
        rule,
        newState,
        previousState,
        triggeredAt,
        condition,
        sampleEvents,
        eventsUrl,
        isTest,
    });
}

/**
 * The pure half of `buildPayload`: everything after the sample events have been
 * fetched and the URL built. Exported so its tests exercise this code rather
 * than a second copy of it — until 2026-08-19 the test file carried its own
 * reimplementation, which meant a change to the real payload shape could not
 * fail a test.
 */
export function assembleAlertPayload({
    rule,
    newState,
    previousState,
    triggeredAt,
    condition,
    sampleEvents,
    eventsUrl,
    isTest,
}: {
    rule: Pick<AlertRule, "id" | "name" | "projectId" | "filter">;
    newState: string;
    previousState: string;
    triggeredAt: Date;
    condition: AlertCondition;
    sampleEvents: SampleEvent[];
    eventsUrl: string;
    isTest: boolean;
}): AlertPayload {
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
            windowMinutes: condition.windowMinutes,
        },
        filter: rule.filter as Record<string, unknown>,
        sample_events: sampleEvents,
        events_url: eventsUrl,
        test: isTest,
    };
}

/**
 * Three events to put in the webhook body.
 *
 * **The whole filter applies here since Phase 4**, not just `levels`. This read
 * stayed on Postgres when Phase 3 moved the evaluator's count, and while it did
 * it also kept a narrower predicate — so a rule filtering on `source` counted
 * one set of events and illustrated itself with another. Both go through
 * `compileFilters` now, which is the same clause from the same code, so the
 * samples are drawn from exactly the rows that were counted.
 *
 * The window matches the evaluator's: half-open, ending at "now". The two calls
 * take their `now` a few milliseconds apart, so a sample can in principle be an
 * event the count did not see — visible only as an illustration slightly newer
 * than the number beside it, which is what an alert body is for.
 */
async function fetchSampleEvents(
    projectId: string,
    filter: EventFilters,
    condition: AlertCondition,
): Promise<SampleEvent[]> {
    const to = new Date();
    const { where, params } = compileFilters(projectId, filter, {
        from: new Date(to.getTime() - condition.windowMinutes * 60 * 1000),
        to,
        toExclusive: true,
    });

    const result = await clickhouse.query({
        query: `SELECT toString(id) AS id,
                       toUnixTimestamp64Milli(timestamp) AS ts_ms,
                       toString(level) AS level,
                       message, error_type, source
                FROM ${EVENTS_TABLE}
                WHERE ${where}
                ORDER BY timestamp DESC, id DESC
                LIMIT ${SAMPLE_EVENT_LIMIT}`,
        query_params: params,
        format: "JSONEachRow",
    });

    return (await result.json<SampleEventRow>()).map((row) => ({
        id: row.id,
        // Built in JavaScript rather than by `formatDateTime`, which emits six
        // fractional digits (`…:00.123000Z`) where every other timestamp in
        // this payload has three. A published webhook body is not the place to
        // change a format by accident.
        timestamp: new Date(Number(row.ts_ms)).toISOString(),
        level: row.level,
        message: row.message,
        // The columns have no `Nullable` (§4.1) and this payload has always
        // carried `null` for a field the caller never sent. Integrators match
        // on that; `""` would be a new value in a published contract.
        error_type: row.error_type === "" ? null : row.error_type,
        source: row.source === "" ? null : row.source,
    }));
}

type SampleEventRow = {
    id: string;
    ts_ms: string;
    level: string;
    message: string;
    error_type: string;
    source: string;
};

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
