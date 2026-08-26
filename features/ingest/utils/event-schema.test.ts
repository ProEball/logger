import { describe, it, expect } from "vitest";
import { eventSchema, batchEventSchema } from "./event-schema";

describe("eventSchema", () => {
    it("accepts a minimal valid event", () => {
        const result = eventSchema.safeParse({ level: "info", message: "hello" });
        expect(result.success).toBe(true);
    });

    it("rejects missing level", () => {
        const result = eventSchema.safeParse({ message: "hello" });
        expect(result.success).toBe(false);
    });

    it("rejects invalid level", () => {
        const result = eventSchema.safeParse({ level: "trace", message: "hello" });
        expect(result.success).toBe(false);
    });

    it("rejects missing message", () => {
        const result = eventSchema.safeParse({ level: "info" });
        expect(result.success).toBe(false);
    });

    it("strips unknown fields", () => {
        const result = eventSchema.safeParse({ level: "warn", message: "ok", unknown_field: "x" });
        expect(result.success).toBe(true);
        if (result.success) {
            expect((result.data as Record<string, unknown>).unknown_field).toBeUndefined();
        }
    });

    it("rejects stack_trace exceeding 32 KB", () => {
        const bigTrace = "x".repeat(32 * 1024 + 1);
        const result = eventSchema.safeParse({ level: "error", message: "oops", stack_trace: bigTrace });
        expect(result.success).toBe(false);
    });

    it("accepts all valid levels", () => {
        for (const level of ["debug", "info", "warn", "error", "fatal"] as const) {
            const result = eventSchema.safeParse({ level, message: "msg" });
            expect(result.success).toBe(true);
        }
    });

    it("accepts optional fields", () => {
        const result = eventSchema.safeParse({
            level: "error",
            message: "fail",
            environment: "production",
            error_type: "TypeError",
            attributes: { key: "value", count: 3 },
        });
        expect(result.success).toBe(true);
    });
});

describe("batchEventSchema", () => {
    it("accepts array of valid events", () => {
        const events = Array.from({ length: 10 }, () => ({ level: "info", message: "batch" }));
        const result = batchEventSchema.safeParse(events);
        expect(result.success).toBe(true);
    });

    it("rejects empty array", () => {
        const result = batchEventSchema.safeParse([]);
        expect(result.success).toBe(false);
    });

    it("rejects array with 501 events", () => {
        const events = Array.from({ length: 501 }, () => ({ level: "info", message: "x" }));
        const result = batchEventSchema.safeParse(events);
        expect(result.success).toBe(false);
    });
});

/**
 * Blank optional fields, added with Phase 2 of the ClickHouse migration.
 *
 * The ClickHouse schema has no Nullable column, so "" and absent are the same
 * row there. Postgres stored them as two distinct values and showed "" as its
 * own entry in the filter bar beside "(unset)". Collapsing them at the schema
 * keeps the two stores agreeing for as long as both exist.
 */
describe("blank optional fields", () => {
    it.each([
        "source",
        "environment",
        "release",
        "user_id",
        "session_id",
        "request_id",
        "trace_id",
        "error_type",
        "stack_trace",
    ])("treats an empty %s as absent rather than as a value", (field) => {
        const result = eventSchema.safeParse({ level: "info", message: "x", [field]: "" });

        expect(result.success).toBe(true);
        expect(result.data?.[field as keyof typeof result.data]).toBeUndefined();
    });

    it("treats a whitespace-only field as absent too", () => {
        const result = eventSchema.safeParse({ level: "info", message: "x", environment: "   " });
        expect(result.data?.environment).toBeUndefined();
    });

    it("accepts the blank rather than rejecting the whole event", () => {
        // An ingest endpoint must not discard an event because a caller sent
        // "" for a field it did not have to send at all. Same call as the
        // X-Forwarded-For guard in to-clickhouse-row.ts.
        expect(eventSchema.safeParse({ level: "info", message: "x", source: "" }).success).toBe(true);
    });

    it("keeps a value that is merely short", () => {
        expect(eventSchema.safeParse({ level: "info", message: "x", environment: "a" }).data?.environment).toBe("a");
    });

    it("still rejects a blank message, which is the event itself", () => {
        expect(eventSchema.safeParse({ level: "info", message: "" }).success).toBe(false);
    });

    it("still enforces the length limits", () => {
        const tooLong = eventSchema.safeParse({ level: "info", message: "x", environment: "e".repeat(129) });
        expect(tooLong.success).toBe(false);
    });
});
