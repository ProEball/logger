import { describe, it, expect } from "vitest";
import { sanitizeTimestamp, EventTimestampOutOfRetentionError } from "./sanitize-timestamp";

describe("sanitizeTimestamp", () => {
    it("returns now when input is undefined", () => {
        const before = Date.now();
        const result = sanitizeTimestamp(undefined);
        const after = Date.now();
        expect(result.getTime()).toBeGreaterThanOrEqual(before);
        expect(result.getTime()).toBeLessThanOrEqual(after);
    });

    it("returns now when timestamp is more than 5 minutes in the future", () => {
        const sixMinutesAhead = new Date(Date.now() + 6 * 60 * 1000).toISOString();
        const before = Date.now();
        const result = sanitizeTimestamp(sixMinutesAhead);
        expect(result.getTime()).toBeGreaterThanOrEqual(before);
    });

    it("accepts timestamp within +5 minutes", () => {
        const fourMinutesAhead = new Date(Date.now() + 4 * 60 * 1000).toISOString();
        const result = sanitizeTimestamp(fourMinutesAhead);
        expect(result.getTime()).toBeGreaterThan(Date.now());
    });

    it("throws EventTimestampOutOfRetentionError for timestamp older than 30 days", () => {
        const thirtyOneDaysAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
        expect(() => sanitizeTimestamp(thirtyOneDaysAgo)).toThrow(EventTimestampOutOfRetentionError);
    });

    it("accepts timestamp within 30 days in the past", () => {
        const twentyNineDaysAgo = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString();
        const result = sanitizeTimestamp(twentyNineDaysAgo);
        expect(result.getTime()).toBeLessThan(Date.now());
    });

    it("accepts recent timestamp as-is", () => {
        const recent = new Date(Date.now() - 1000).toISOString();
        const result = sanitizeTimestamp(recent);
        expect(result.getTime()).toBeLessThan(Date.now());
        expect(result.getTime()).toBeGreaterThan(Date.now() - 2000);
    });
});
