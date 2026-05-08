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
