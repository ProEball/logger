import { describe, it, expect } from "vitest";
import { pickBucket, resolveRange } from "@/features/dashboard/utils/aggregation-utils";

// ─── pickBucket ──────────────────────────────────────────────────────────────

describe("pickBucket", () => {
    function bucket(minutes: number): ReturnType<typeof pickBucket> {
        const from = new Date(0);
        const to = new Date(minutes * 60_000);
        return pickBucket(from, to);
    }

    it("returns 1m for exactly 60 minutes", () => {
        expect(bucket(60)).toBe("1m");
    });

    it("returns 1m for 1 minute (minimum)", () => {
        expect(bucket(1)).toBe("1m");
    });

    it("returns 5m for 61 minutes", () => {
        expect(bucket(61)).toBe("5m");
    });

    it("returns 5m for exactly 360 minutes (6h)", () => {
        expect(bucket(360)).toBe("5m");
    });

    it("returns 15m for 361 minutes", () => {
        expect(bucket(361)).toBe("15m");
    });

    it("returns 15m for exactly 1440 minutes (24h)", () => {
        expect(bucket(1440)).toBe("15m");
    });

    it("returns 1h for 1441 minutes", () => {
        expect(bucket(1441)).toBe("1h");
    });

    it("returns 1h for exactly 10080 minutes (7d)", () => {
        expect(bucket(10080)).toBe("1h");
    });

    it("returns 4h for 10081 minutes (>7d)", () => {
        expect(bucket(10081)).toBe("4h");
    });

    it("returns 4h for 30 days (full retention window)", () => {
        expect(bucket(30 * 24 * 60)).toBe("4h");
    });
});

// ─── resolveRange ────────────────────────────────────────────────────────────

describe("resolveRange", () => {
    it("resolves preset '1h' to ~1 hour window", () => {
        const { from, to } = resolveRange({ type: "preset", value: "1h" });
        const diffMs = to.getTime() - from.getTime();
        expect(diffMs).toBeCloseTo(60 * 60 * 1000, -3); // within 1s
    });

    it("resolves preset '30d' to ~30 day window", () => {
        const { from, to } = resolveRange({ type: "preset", value: "30d" });
        const diffMs = to.getTime() - from.getTime();
        expect(diffMs).toBeCloseTo(30 * 24 * 60 * 60 * 1000, -3);
    });

    it("resolves custom range to exact dates", () => {
        const fromStr = "2024-01-01T00:00:00.000Z";
        const toStr = "2024-01-07T00:00:00.000Z";
        const { from, to } = resolveRange({ type: "custom", from: fromStr, to: toStr });
        expect(from.toISOString()).toBe(fromStr);
        expect(to.toISOString()).toBe(toStr);
    });

    it("to is always >= from", () => {
        for (const preset of ["15m", "1h", "6h", "24h", "7d", "30d"] as const) {
            const { from, to } = resolveRange({ type: "preset", value: preset });
            expect(to.getTime()).toBeGreaterThanOrEqual(from.getTime());
        }
    });
});
