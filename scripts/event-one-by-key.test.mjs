import { describe, expect, it } from "vitest";
import { intervalMs, targetRateAt } from "./event-one-by-key.mjs";

const NO_JITTER = { min: 300, max: 500, periodMs: 600_000, jitter: 0 };

describe("targetRateAt", () => {
    it("starts at the midpoint of the envelope", () => {
        // sin(0) = 0, so the wave sits halfway between min and max.
        expect(targetRateAt(0, NO_JITTER)).toBe(400);
    });

    it("peaks at max a quarter of the way through the period", () => {
        expect(targetRateAt(150_000, NO_JITTER)).toBe(500);
    });

    it("returns to the midpoint at half the period", () => {
        expect(targetRateAt(300_000, NO_JITTER)).toBe(400);
    });

    it("bottoms out at min three quarters of the way through", () => {
        expect(targetRateAt(450_000, NO_JITTER)).toBe(300);
    });

    it("repeats after a full period", () => {
        expect(targetRateAt(600_000, NO_JITTER)).toBe(targetRateAt(0, NO_JITTER));
    });

    it("clamps inside the envelope even at maximum positive jitter", () => {
        const options = { ...NO_JITTER, jitter: 0.5 };
        expect(targetRateAt(150_000, options, () => 1)).toBe(500);
    });

    it("clamps inside the envelope even at maximum negative jitter", () => {
        const options = { ...NO_JITTER, jitter: 0.5 };
        expect(targetRateAt(450_000, options, () => 0)).toBe(300);
    });

    it("stays inside the envelope across a whole period with real noise", () => {
        for (let t = 0; t <= 600_000; t += 5_000) {
            const rate = targetRateAt(t, { ...NO_JITTER, jitter: 0.08 });
            expect(rate).toBeGreaterThanOrEqual(300);
            expect(rate).toBeLessThanOrEqual(500);
        }
    });

    it("collapses to a constant when min equals max", () => {
        expect(targetRateAt(123_456, { min: 400, max: 400, periodMs: 600_000, jitter: 0.5 })).toBe(400);
    });

    it("rejects a non-positive minimum", () => {
        expect(() => targetRateAt(0, { ...NO_JITTER, min: 0 })).toThrow(/min/);
    });

    it("rejects an inverted envelope", () => {
        expect(() => targetRateAt(0, { min: 500, max: 300, periodMs: 600_000 })).toThrow(/max/);
    });

    it("rejects a non-positive period", () => {
        expect(() => targetRateAt(0, { ...NO_JITTER, periodMs: 0 })).toThrow(/periodMs/);
    });
});

describe("intervalMs", () => {
    it("spaces 500 per minute 120 ms apart", () => {
        expect(intervalMs(500)).toBe(120);
    });

    it("spaces 300 per minute 200 ms apart", () => {
        expect(intervalMs(300)).toBe(200);
    });

    it("keeps sub-millisecond precision so pacing does not drift", () => {
        // 60000/450 = 133.33…; rounding here would cost ~1% of the target rate.
        expect(intervalMs(450)).toBeCloseTo(133.333, 3);
    });

    it("rejects a non-positive rate", () => {
        expect(() => intervalMs(0)).toThrow(/eventsPerMinute/);
    });
});
