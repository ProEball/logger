import type { TimeRange } from "@/features/events/utils/event-filters.types";

// ─── Time-range resolution ────────────────────────────────────────────────────

export const PRESET_OFFSETS_MS: Record<string, number> = {
    "15m": 15 * 60 * 1000,
    "1h":  60 * 60 * 1000,
    "6h":  6  * 60 * 60 * 1000,
    "24h": 24 * 60 * 60 * 1000,
    "7d":  7  * 24 * 60 * 60 * 1000,
    "30d": 30 * 24 * 60 * 60 * 1000,
};

export function resolveRange(range: TimeRange): { from: Date; to: Date } {
    if (range.type === "custom") {
        return { from: new Date(range.from), to: new Date(range.to) };
    }
    const now = new Date();
    const offset = PRESET_OFFSETS_MS[range.value] ?? PRESET_OFFSETS_MS["1h"];
    return { from: new Date(now.getTime() - offset), to: now };
}

// ─── Bucket sizing ────────────────────────────────────────────────────────────

export type BucketSize = "1m" | "5m" | "15m" | "1h" | "4h";

/** Seconds per bucket — used with epoch-floor arithmetic in SQL. */
export const BUCKET_SECONDS: Record<BucketSize, number> = {
    "1m":  60,
    "5m":  300,
    "15m": 900,
    "1h":  3_600,
    "4h":  14_400,
};

/**
 * Choose a bucket width that yields 60–180 data points for the given range.
 * Boundaries: ≤1h→1m, ≤6h→5m, ≤24h→15m, ≤7d→1h, >7d→4h.
 */
export function pickBucket(from: Date, to: Date): BucketSize {
    const minutes = (to.getTime() - from.getTime()) / 60_000;
    if (minutes <= 60)    return "1m";
    if (minutes <= 360)   return "5m";
    if (minutes <= 1440)  return "15m";
    if (minutes <= 10080) return "1h";
    return "4h";
}
