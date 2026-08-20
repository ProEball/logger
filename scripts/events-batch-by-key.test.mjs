import { describe, expect, it } from "vitest";
import { delayBetweenBatchesMs, nextBatchSize } from "./events-batch-by-key.mjs";

describe("delayBetweenBatchesMs", () => {
    it("spaces batches to hit the target rate", () => {
        // 960/min at 500 per request → just under two requests a minute.
        expect(delayBetweenBatchesMs(960, 500)).toBe(31_250);
    });

    it("halves the pause when the batch halves", () => {
        expect(delayBetweenBatchesMs(1000, 250)).toBe(15_000);
    });

    it("rejects a non-positive rate", () => {
        expect(() => delayBetweenBatchesMs(0, 500)).toThrow(/eventsPerMinute/);
    });

    it("rejects a non-positive batch size", () => {
        expect(() => delayBetweenBatchesMs(1000, 0)).toThrow(/batchSize/);
    });
});

describe("nextBatchSize", () => {
    it("returns the full batch when plenty remains", () => {
        expect(nextBatchSize(0, 2000, 500)).toBe(500);
    });

    it("shrinks the final batch to land exactly on the total", () => {
        expect(nextBatchSize(1800, 2000, 500)).toBe(200);
    });

    it("returns zero once the total is reached", () => {
        expect(nextBatchSize(2000, 2000, 500)).toBe(0);
    });

    it("never returns a negative size past the total", () => {
        expect(nextBatchSize(2500, 2000, 500)).toBe(0);
    });
});
