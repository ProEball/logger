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

export type BucketSize = "1m" | "1h" | "12h" | "1d";

/** Seconds per bucket — used with epoch-floor arithmetic in SQL. */
export const BUCKET_SECONDS: Record<BucketSize, number> = {
    "1m":  60,
    "1h":  3_600,
    "12h": 43_200,
    "1d":  86_400,
};

/**
 * Choose a bucket width tied to the range length, matching the dashboard's
 * range filter: ~1h→1m, ~24h→1h, ~7d→12h, ~30d→1d. Keeps the point count
 * small regardless of range (max ~60), so wide ranges stay fast to render.
 */
export function pickBucket(from: Date, to: Date): BucketSize {
    const minutes = (to.getTime() - from.getTime()) / 60_000;
    if (minutes <= 60)    return "1m";
    if (minutes <= 1440)  return "1h";
    if (minutes <= 10080) return "12h";
    return "1d";
}

// ─── Bucket zero-fill ─────────────────────────────────────────────────────────

export type BucketRow = {
    ts: Date;
    total: number;
    byLevel: Record<string, number>;
};

/**
 * Fill gaps in a sparse BucketRow[] (one row per bucket that actually had
 * events) with zero-count rows, so the series covers every bucket in
 * [from, to) contiguously. Without this, a gap in events makes the series
 * stop short instead of showing a drop to zero.
 *
 * Bucket boundaries are computed the same way as the SQL query (epoch-floor
 * to the bucket width), so filled timestamps line up with real ones.
 */
export function fillBuckets(
    rows: BucketRow[],
    from: Date,
    to: Date,
    bucketSize: BucketSize,
): BucketRow[] {
    const bucketMs = BUCKET_SECONDS[bucketSize] * 1000;
    const firstBucketMs = Math.floor(from.getTime() / bucketMs) * bucketMs;
    // `to` is an exclusive upper bound; the last bucket is the one containing (to - 1ms).
    const lastBucketMs = Math.floor((to.getTime() - 1) / bucketMs) * bucketMs;

    const byTs = new Map(rows.map((r) => [r.ts.getTime(), r]));
    const filled: BucketRow[] = [];
    for (let ts = firstBucketMs; ts <= lastBucketMs; ts += bucketMs) {
        filled.push(byTs.get(ts) ?? { ts: new Date(ts), total: 0, byLevel: {} });
    }
    return filled;
}
