import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * The database is mocked; `overview.service` is not. §11 allows mocking a real
 * system boundary and forbids mocking an internal module, and the thing under
 * test here is precisely whether a second read reaches the database — which is
 * only observable with the real service in the path.
 */
const { executeMock } = vi.hoisted(() => ({ executeMock: vi.fn() }));
vi.mock("@/core/db/client", () => ({ db: { execute: executeMock } }));

import {
    cachedProjectStats,
    cachedProjectTopMessages,
    cachedOrgTopErrors,
    cachedOrgLevelBreakdown,
    cachedOrgEnvironments,
    cachedOrgEventBuckets,
    clearOverviewCaches,
    OVERVIEW_CACHE_TTL_MS,
    OVERVIEW_CACHE_MAX_STALE_MS,
} from "./overview-cache.service";
import { readCacheSettings } from "@/shared/utils/read-cache-settings";

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const RANGE = { from: new Date("2026-08-20T00:00:00Z"), to: new Date("2026-08-20T12:00:00Z") };

/** Queries issued since the last reset. The caches are module-level singletons. */
function queryCount() {
    return executeMock.mock.calls.length;
}

beforeEach(() => {
    clearOverviewCaches();
    executeMock.mockReset();
    executeMock.mockResolvedValue([]);
});

describe("overview cache", () => {
    describe("settings", () => {
        it("matches the shortest auto-refresh interval", () => {
            expect(OVERVIEW_CACHE_TTL_MS).toBe(30_000);
        });

        it("allows serving stale for longer than the refresh interval", () => {
            expect(OVERVIEW_CACHE_MAX_STALE_MS).toBeGreaterThan(OVERVIEW_CACHE_TTL_MS);
        });

        it("caches for 30 seconds off the e2e server", () => {
            expect(readCacheSettings(false)).toEqual({ ttlMs: 30_000, maxStaleMs: 300_000 });
        });

        /**
         * Both values, not just the TTL: a 1 ms TTL with a five-minute ceiling
         * still serves stale for five minutes, from the refresh branch rather
         * than the fresh one. That would leave the e2e hazard exactly where it
         * was while looking like it had been fixed.
         */
        it("holds nothing long enough for an e2e test to read a stale value", () => {
            const e2e = readCacheSettings(true);

            expect(e2e.ttlMs).toBeLessThanOrEqual(1);
            expect(e2e.maxStaleMs).toBeLessThanOrEqual(1);
        });
    });

    /**
     * The reason the whole layer exists: a hundred readers of one organization
     * must cost one query, not a hundred.
     */
    describe("serves repeat reads without touching the database", () => {
        it("reuses the result for identical statistics reads", async () => {
            await cachedProjectStats([P1, P2], "7d", RANGE);
            const afterFirst = queryCount();
            expect(afterFirst).toBeGreaterThan(0);

            await cachedProjectStats([P1, P2], "7d", RANGE);

            expect(queryCount()).toBe(afterFirst);
        });

        it("collapses concurrent readers into one set of queries", async () => {
            await Promise.all([
                cachedOrgEnvironments([P1]),
                cachedOrgEnvironments([P1]),
                cachedOrgEnvironments([P1]),
            ]);

            expect(queryCount()).toBe(1);
        });

        it.each([
            ["top errors", () => cachedOrgTopErrors([P1], "24h", RANGE)],
            ["level breakdown", () => cachedOrgLevelBreakdown([P1], "7d", RANGE)],
            ["environments", () => cachedOrgEnvironments([P1])],
            ["buckets", () => cachedOrgEventBuckets([P1], "7d", RANGE, 3600)],
        ])("reuses the result for %s", async (_label, read) => {
            await read();
            const afterFirst = queryCount();

            await read();

            expect(queryCount()).toBe(afterFirst);
        });
    });

    /**
     * The scope is a permission boundary. This asserts the separation end to
     * end — that a differing project list actually reaches the database again,
     * not merely that the key strings differ.
     */
    describe("never serves one project scope's answer to another", () => {
        it("re-queries for a different project set", async () => {
            await cachedProjectStats([P1], "7d", RANGE);
            const afterFirst = queryCount();

            await cachedProjectStats([P2], "7d", RANGE);

            expect(queryCount()).toBeGreaterThan(afterFirst);
        });

        it("re-queries when a project is added to the scope", async () => {
            await cachedOrgEnvironments([P1]);
            await cachedOrgEnvironments([P1, P2]);

            expect(queryCount()).toBe(2);
        });

        it("treats a reordered project list as the same scope", async () => {
            await cachedOrgEnvironments([P1, P2]);
            await cachedOrgEnvironments([P2, P1]);

            expect(queryCount()).toBe(1);
        });
    });

    /**
     * The split of 2026-08-20. The statistics cost ~30 ms and the per-project
     * top message ~954 ms; behind one promise and one cache entry, nothing that
     * needed the first could be served without the second. These assert the two
     * are genuinely independent, which is the only property the split delivers.
     */
    describe("keeps statistics independent of the top-message query", () => {
        it("issues no message query when only statistics are read", async () => {
            await cachedProjectStats([P1], "7d", RANGE);

            const sql = executeMock.mock.calls.map((c) => JSON.stringify(c[0])).join(" ");
            expect(sql).not.toContain("ranked");
        });

        it("issues no statistics query when only the top message is read", async () => {
            await cachedProjectTopMessages([P1], "7d", RANGE);

            const sql = executeMock.mock.calls.map((c) => JSON.stringify(c[0])).join(" ");
            expect(sql).not.toContain("event_rollup_minutes");
        });

        /**
        /**
         * The property worth protecting is that one read covers the whole
         * project list — not a literal query count.
         *
         * It asserted `toBe(1)` until 2026-08-24, on the premise that this
         * query "reads raw `events` only, so it has no rollup boundary to wait
         * for first". That premise is gone: it now asks how far the template
         * rollup covers before choosing an implementation. The count changed
         * for a reason that has nothing to do with fanning out per project,
         * which is what the test exists to catch.
         */
        it("reads the top message without fanning out per project", async () => {
            await cachedProjectTopMessages([P1], "7d", RANGE);
            const forOne = queryCount();

            clearOverviewCaches();
            executeMock.mockClear();
            await cachedProjectTopMessages([P1, P2, "33333333-3333-4333-8333-333333333333"], "7d", RANGE);

            expect(queryCount()).toBe(forOne);
            expect(forOne).toBeGreaterThan(0);
        });

        it("caches them under separate entries", async () => {
            await cachedProjectStats([P1], "7d", RANGE);
            const afterStats = queryCount();

            await cachedProjectTopMessages([P1], "7d", RANGE);

            expect(queryCount()).toBeGreaterThan(afterStats);
        });
    });

    describe("separates different questions", () => {
        it("re-queries for a different preset", async () => {
            await cachedOrgTopErrors([P1], "24h", RANGE);
            const afterFirst = queryCount();

            await cachedOrgTopErrors([P1], "7d", RANGE);

            expect(queryCount()).toBeGreaterThan(afterFirst);
        });

        it("re-queries for a different environment filter", async () => {
            await cachedProjectStats([P1], "7d", RANGE, ["production"]);
            const afterFirst = queryCount();

            await cachedProjectStats([P1], "7d", RANGE, ["staging"]);

            expect(queryCount()).toBeGreaterThan(afterFirst);
        });

        it("re-queries for a different bucket width", async () => {
            await cachedOrgEventBuckets([P1], "7d", RANGE, 60);
            const afterFirst = queryCount();

            await cachedOrgEventBuckets([P1], "7d", RANGE, 3600);

            expect(queryCount()).toBeGreaterThan(afterFirst);
        });

        it("keeps two queries with identical arguments apart", async () => {
            await cachedOrgLevelBreakdown([P1], "7d", RANGE);
            const afterBreakdown = queryCount();

            await cachedOrgTopErrors([P1], "7d", RANGE);

            expect(queryCount()).toBeGreaterThan(afterBreakdown);
        });
    });

    describe("failure handling", () => {
        it("propagates a query failure instead of caching it", async () => {
            executeMock.mockRejectedValue(new Error("db down"));

            await expect(cachedOrgEnvironments([P1])).rejects.toThrow("db down");
        });

        it("retries after a failure rather than serving nothing forever", async () => {
            executeMock.mockRejectedValueOnce(new Error("transient"));
            await expect(cachedOrgEnvironments([P1])).rejects.toThrow("transient");

            executeMock.mockResolvedValue([{ environment: "prod" }]);

            await expect(cachedOrgEnvironments([P1])).resolves.toEqual(["prod"]);
        });
    });

    it("clears every cache", async () => {
        await cachedOrgEnvironments([P1]);
        clearOverviewCaches();
        await cachedOrgEnvironments([P1]);

        expect(queryCount()).toBe(2);
    });
});
