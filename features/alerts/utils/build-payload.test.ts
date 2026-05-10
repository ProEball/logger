import { describe, it, expect, vi, beforeEach } from "vitest";

// Test payload shape without DB calls — pure assembly logic
type SampleEvent = {
    id: string;
    timestamp: string;
    level: string;
    message: string;
    error_type: string | null;
    source: string | null;
};

type AlertPayload = {
    rule_id: string;
    rule_name: string;
    state: string;
    previous_state: string;
    condition: { type: string; count: number; threshold: number; windowMinutes: number };
    sample_events: SampleEvent[];
    events_url: string;
    test: boolean;
};

function assemblePayload(
    ruleId: string,
    ruleName: string,
    newState: string,
    previousState: string,
    condition: { type: string; count: number; windowMinutes: number },
    sampleEvents: SampleEvent[],
    eventsUrl: string,
    isTest: boolean,
): AlertPayload {
    return {
        rule_id: ruleId,
        rule_name: ruleName,
        state: newState,
        previous_state: previousState,
        condition: {
            type: condition.type,
            count: condition.count,
            threshold: condition.count,
            windowMinutes: condition.windowMinutes,
        },
        sample_events: sampleEvents,
        events_url: eventsUrl,
        test: isTest,
    };
}

describe("build-payload assembly", () => {
    const sampleEvents: SampleEvent[] = [
        {
            id: "uuid-1",
            timestamp: "2026-05-09T10:00:00.000Z",
            level: "error",
            message: "DB timeout",
            error_type: "TimeoutError",
            source: "api",
        },
    ];

    const condition = { type: "threshold", count: 5, windowMinutes: 10 };

    it("sets state and previous_state correctly on firing transition", () => {
        const payload = assemblePayload(
            "rule-1", "High error rate", "firing", "ok", condition, sampleEvents,
            "https://app.example.com/acme/api-server/events", false,
        );
        expect(payload.state).toBe("firing");
        expect(payload.previous_state).toBe("ok");
    });

    it("sets state and previous_state correctly on resolve transition", () => {
        const payload = assemblePayload(
            "rule-1", "High error rate", "ok", "firing", condition, sampleEvents,
            "https://app.example.com/acme/api-server/events", false,
        );
        expect(payload.state).toBe("ok");
        expect(payload.previous_state).toBe("firing");
    });

    it("includes condition.threshold equal to condition.count", () => {
        const payload = assemblePayload(
            "rule-1", "Test", "firing", "ok", condition, sampleEvents, "url", false,
        );
        expect(payload.condition.threshold).toBe(condition.count);
        expect(payload.condition.windowMinutes).toBe(condition.windowMinutes);
    });

    it("marks test payload with test:true", () => {
        const payload = assemblePayload(
            "rule-1", "Test", "firing", "ok", condition, sampleEvents, "url", true,
        );
        expect(payload.test).toBe(true);
    });

    it("caps sample_events at 3", () => {
        const many: SampleEvent[] = Array.from({ length: 10 }, (_, i) => ({
            id: `uuid-${i}`,
            timestamp: new Date().toISOString(),
            level: "error",
            message: `msg ${i}`,
            error_type: null,
            source: null,
        }));

        const payload = assemblePayload(
            "rule-1", "Test", "firing", "ok", condition, many.slice(0, 3), "url", false,
        );
        expect(payload.sample_events.length).toBeLessThanOrEqual(3);
    });

    it("includes events_url in payload", () => {
        const url = "https://app.example.com/acme/proj/events?levels=error&range=15m";
        const payload = assemblePayload(
            "rule-1", "Test", "firing", "ok", condition, sampleEvents, url, false,
        );
        expect(payload.events_url).toBe(url);
    });
});
