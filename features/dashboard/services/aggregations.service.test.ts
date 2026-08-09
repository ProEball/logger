import { describe, it, expect } from "vitest";
import { pickBucket, resolveRange, fillBuckets } from "@/features/dashboard/utils/aggregation-utils";
import type { BucketRow } from "@/features/dashboard/utils/aggregation-utils";

// ─── pickBucket ──────────────────────────────────────────────────────────────

describe("pickBucket", () => {
    function bucket(minutes: number): ReturnType<typeof pickBucket> {
        const from = new Date(0);
        const to = new Date(minutes * 60_000);
        return pickBucket(from, to);
    }

    it("returns 1m for exactly 60 minutes (1h filter)", () => {
        expect(bucket(60)).toBe("1m");
    });

    it("returns 1m for 1 minute (minimum)", () => {
        expect(bucket(1)).toBe("1m");
    });

    it("returns 1h for 61 minutes", () => {
        expect(bucket(61)).toBe("1h");
    });

    it("returns 1h for exactly 1440 minutes (24h filter)", () => {
        expect(bucket(1440)).toBe("1h");
    });

    it("returns 12h for 1441 minutes", () => {
        expect(bucket(1441)).toBe("12h");
    });

    it("returns 12h for exactly 10080 minutes (7d filter)", () => {
        expect(bucket(10080)).toBe("12h");
    });

    it("returns 1d for 10081 minutes (>7d)", () => {
        expect(bucket(10081)).toBe("1d");
    });

    it("returns 1d for 30 days (30d filter)", () => {
        expect(bucket(30 * 24 * 60)).toBe("1d");
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

// ─── fillBuckets ─────────────────────────────────────────────────────────────

describe("fillBuckets", () => {
    it("fills a gap with zero-count rows instead of leaving it missing", () => {
        const from = new Date("2024-01-01T00:00:00.000Z");
        const to = new Date("2024-01-01T00:05:00.000Z");
        const rows: BucketRow[] = [
            { ts: new Date("2024-01-01T00:00:00.000Z"), total: 3, byLevel: { info: 3 } },
            // 00:01 and 00:02 missing — logs stopped
            { ts: new Date("2024-01-01T00:03:00.000Z"), total: 1, byLevel: { error: 1 } },
        ];

        const filled = fillBuckets(rows, from, to, "1m");

        expect(filled.map((r) => r.ts.toISOString())).toEqual([
            "2024-01-01T00:00:00.000Z",
            "2024-01-01T00:01:00.000Z",
            "2024-01-01T00:02:00.000Z",
            "2024-01-01T00:03:00.000Z",
            "2024-01-01T00:04:00.000Z",
        ]);
        expect(filled[1]).toEqual({ ts: new Date("2024-01-01T00:01:00.000Z"), total: 0, byLevel: {} });
        expect(filled[2]).toEqual({ ts: new Date("2024-01-01T00:02:00.000Z"), total: 0, byLevel: {} });
        expect(filled[0].total).toBe(3);
        expect(filled[3].total).toBe(1);
    });

    it("returns an all-zero series covering the whole range when no rows are given", () => {
        const from = new Date("2024-01-01T00:00:00.000Z");
        const to = new Date("2024-01-01T00:03:00.000Z");

        const filled = fillBuckets([], from, to, "1m");

        expect(filled).toHaveLength(3);
        expect(filled.every((r) => r.total === 0)).toBe(true);
    });

    it("does not include a bucket starting exactly at `to` (exclusive upper bound)", () => {
        const from = new Date("2024-01-01T00:00:00.000Z");
        const to = new Date("2024-01-01T00:02:00.000Z");

        const filled = fillBuckets([], from, to, "1m");

        expect(filled.map((r) => r.ts.toISOString())).toEqual([
            "2024-01-01T00:00:00.000Z",
            "2024-01-01T00:01:00.000Z",
        ]);
    });

    it("aligns bucket boundaries to the bucket width even when `from` is unaligned", () => {
        const from = new Date("2024-01-01T00:00:30.000Z");
        const to = new Date("2024-01-01T00:02:00.000Z");

        const filled = fillBuckets([], from, to, "1m");

        expect(filled.map((r) => r.ts.toISOString())).toEqual([
            "2024-01-01T00:00:00.000Z",
            "2024-01-01T00:01:00.000Z",
        ]);
    });
});
