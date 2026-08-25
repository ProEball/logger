import { describe, it, expect } from "vitest";
import { readCacheSettings, readLiveCacheSettings } from "./read-cache-settings";

describe("readCacheSettings", () => {
    it("caches for 30 seconds off the e2e server", () => {
        expect(readCacheSettings(false)).toEqual({ ttlMs: 30_000, maxStaleMs: 300_000 });
    });

    it("allows serving stale for longer than the refresh interval", () => {
        const live = readCacheSettings(false);

        expect(live.maxStaleMs).toBeGreaterThan(live.ttlMs);
    });

    /**
     * Both values, not just the TTL. A 1 ms TTL under a five-minute ceiling
     * still serves stale for five minutes — from the background-refresh branch
     * rather than the fresh one — which would leave the e2e hazard exactly
     * where it was while looking like it had been fixed.
     *
     * The hazard: a spec that ingests events and then asserts on a dashboard
     * would be served the previous spec's numbers, fail with figures that look
     * plausible rather than wrong, and offer nothing pointing at a cache.
     */
    it("holds nothing long enough for an e2e spec to read a stale value", () => {
        const e2e = readCacheSettings(true);

        expect(e2e.ttlMs).toBeLessThanOrEqual(1);
        expect(e2e.maxStaleMs).toBeLessThanOrEqual(1);
    });

    /**
     * `createTtlCache` rejects `maxStaleMs < ttlMs`, so a settings pair that
     * violated it would throw at module load — in production, on the first
     * import, rather than in a test.
     */
    it.each([[true], [false]])("returns a pair createTtlCache accepts (e2e: %s)", (isE2E) => {
        const { ttlMs, maxStaleMs } = readCacheSettings(isE2E);

        expect(ttlMs).toBeGreaterThan(0);
        expect(maxStaleMs).toBeGreaterThanOrEqual(ttlMs);
    });
});

describe("readLiveCacheSettings", () => {
    it("is shorter than the standard profile", () => {
        // The point of a second profile: a reading about the current minute
        // cannot be allowed to be as stale as a range aggregate.
        expect(readLiveCacheSettings(false).ttlMs).toBeLessThan(readCacheSettings(false).ttlMs);
    });

    it("holds for ten seconds live", () => {
        expect(readLiveCacheSettings(false).ttlMs).toBe(10_000);
    });

    /**
     * The ceiling is about database outages, not freshness — a failing refresh
     * should keep serving the last good value for as long here as anywhere
     * else, or this one number would vanish during a blip that left the rest of
     * the page standing.
     */
    it("keeps the same staleness ceiling as the standard profile", () => {
        expect(readLiveCacheSettings(false).maxStaleMs).toBe(readCacheSettings(false).maxStaleMs);
    });

    it("collapses to 1 ms under e2e, like the standard profile", () => {
        expect(readLiveCacheSettings(true)).toEqual({ ttlMs: 1, maxStaleMs: 1 });
    });
});
