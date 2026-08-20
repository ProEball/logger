import { describe, it, expect } from "vitest";
import { assembleAlertPayload, type SampleEvent } from "@/features/alerts/utils/build-payload";
import type { AlertCondition } from "@/features/alerts/utils/alert-schemas";

// These tests exercise the real assembly function. Until 2026-08-19 this file
// carried its own reimplementation of it, so a change to the shipped payload
// shape could not fail a test here — which is how an undocumented `threshold`
// field survived in the payload for months.

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

const condition: AlertCondition = { type: "threshold", count: 5, windowMinutes: 10 };

const rule = {
    id: "rule-1",
    name: "High error rate",
    projectId: "project-1",
    filter: { levels: ["error"] },
};

function assemble(overrides: Partial<Parameters<typeof assembleAlertPayload>[0]> = {}) {
    return assembleAlertPayload({
        rule,
        newState: "firing",
        previousState: "ok",
        triggeredAt: new Date("2026-05-09T10:05:00.000Z"),
        condition,
        sampleEvents,
        eventsUrl: "https://app.example.com/acme/api-server/events",
        isTest: false,
        ...overrides,
    });
}

describe("assembleAlertPayload", () => {
    it("carries rule identity through to the payload", () => {
        const payload = assemble();
        expect(payload.rule_id).toBe("rule-1");
        expect(payload.rule_name).toBe("High error rate");
        expect(payload.project_id).toBe("project-1");
    });

    it("sets state and previous_state on a firing transition", () => {
        const payload = assemble();
        expect(payload.state).toBe("firing");
        expect(payload.previous_state).toBe("ok");
    });

    it("sets state and previous_state on a resolve transition", () => {
        const payload = assemble({ newState: "ok", previousState: "firing" });
        expect(payload.state).toBe("ok");
        expect(payload.previous_state).toBe("firing");
    });

    it("serialises triggered_at as ISO 8601", () => {
        expect(assemble().triggered_at).toBe("2026-05-09T10:05:00.000Z");
    });

    it("mirrors the stored condition shape", () => {
        expect(assemble().condition).toEqual({
            type: "threshold",
            count: 5,
            windowMinutes: 10,
        });
    });

    it("does not emit a threshold alias of count", () => {
        // Removed 2026-08-19: it duplicated `count`, had no consumer, and was
        // absent from docs/reference/logging.md. Re-adding it would put the
        // payload out of step with the documented contract again.
        expect(assemble().condition).not.toHaveProperty("threshold");
    });

    it("passes the rule filter through untouched", () => {
        expect(assemble().filter).toEqual({ levels: ["error"] });
    });

    it("passes sample events through unchanged", () => {
        // The three-event cap lives in the query that fetches them, not here.
        expect(assemble().sample_events).toEqual(sampleEvents);
    });

    it("accepts an empty sample list, as a resolve notification produces", () => {
        expect(assemble({ sampleEvents: [] }).sample_events).toEqual([]);
    });

    it("includes events_url verbatim", () => {
        const eventsUrl = "https://app.example.com/acme/proj/events?levels=error&range=15m";
        expect(assemble({ eventsUrl }).events_url).toBe(eventsUrl);
    });

    it("marks a test payload with test:true", () => {
        expect(assemble({ isTest: true }).test).toBe(true);
    });

    it("marks a real payload with test:false", () => {
        expect(assemble().test).toBe(false);
    });
});
