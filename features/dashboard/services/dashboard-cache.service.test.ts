import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * The database is mocked; `aggregations.service` is not. §11 allows mocking a
 * real system boundary and forbids mocking an internal module, and the thing
 * under test is whether a second read reaches the database — only observable
 * with the real service in the path.
 */
const { executeMock } = vi.hoisted(() => ({ executeMock: vi.fn() }));
vi.mock("@/core/db/client", () => ({ db: { execute: executeMock } }));

import {
    cachedEventsPerMinute,
    cachedLevelBreakdown,
    cachedRecentErrors,
    cachedTopMessages,
    cachedTopSources,
    clearDashboardCaches,
} from "./dashboard-cache.service";
import type { TimeRange } from "@/shared/utils/event-filters.schema";

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const HOUR: TimeRange = { type: "preset", value: "1h" };
const WEEK: TimeRange = { type: "preset", value: "7d" };

function queryCount() {
    return executeMock.mock.calls.length;
}

beforeEach(() => {
    clearDashboardCaches();
    executeMock.mockReset();
    executeMock.mockResolvedValue([]);
});

describe("dashboard cache", () => {
    /** The reason the layer exists: N readers of a project cost one query. */
    describe("serves repeat reads without touching the database", () => {
        it.each([
            ["buckets", () => cachedEventsPerMinute(P1, HOUR)],
            ["level breakdown", () => cachedLevelBreakdown(P1, HOUR)],
            ["top messages", () => cachedTopMessages(P1, HOUR)],
            ["recent errors", () => cachedRecentErrors(P1, HOUR)],
            ["top sources", () => cachedTopSources(P1, HOUR)],
        ])("reuses the result for %s", async (_label, read) => {
            await read();
            const afterFirst = queryCount();
            expect(afterFirst).toBeGreaterThan(0);

            await read();

            expect(queryCount()).toBe(afterFirst);
        });

        it("collapses concurrent readers into one set of queries", async () => {
            await Promise.all([
                cachedTopMessages(P1, HOUR),
                cachedTopMessages(P1, HOUR),
                cachedTopMessages(P1, HOUR),
            ]);

            expect(queryCount()).toBe(1);
        });
    });

    /**
     * The project id is the permission boundary here, exactly as the project
     * *list* is on the org overview. Asserted end to end — that a different
     * project actually reaches the database again, not merely that the key
     * strings differ.
     */
    describe("never serves one project's answer to another", () => {
        it("re-queries for a different project", async () => {
            await cachedTopMessages(P1, HOUR);
            const afterFirst = queryCount();

            await cachedTopMessages(P2, HOUR);

            expect(queryCount()).toBeGreaterThan(afterFirst);
        });

        it("keeps every query type separated per project", async () => {
            await cachedLevelBreakdown(P1, HOUR);
            const afterFirst = queryCount();

            await cachedLevelBreakdown(P2, HOUR);

            // Strictly greater, not ">= 2": one call already issues two
            // statements (the rollup boundary and the breakdown), so a
            // threshold of 2 would pass even if P2 were wrongly served P1's
            // cached entry — which is the only thing this test is for.
            expect(queryCount()).toBeGreaterThan(afterFirst);
        });
    });

    describe("separates different questions", () => {
        it("re-queries for a different preset", async () => {
            await cachedTopMessages(P1, HOUR);
            const afterFirst = queryCount();

            await cachedTopMessages(P1, WEEK);

            expect(queryCount()).toBeGreaterThan(afterFirst);
        });

        it("keeps two queries with identical arguments apart", async () => {
            await cachedTopSources(P1, HOUR);
            const afterSources = queryCount();

            await cachedRecentErrors(P1, HOUR);

            expect(queryCount()).toBeGreaterThan(afterSources);
        });
    });

    /**
     * A custom range cannot be keyed — its key would carry resolved timestamps
     * and never repeat. Nothing reachable from a URL produces one, so this
     * guards a future caller: reading straight through is correct, filling the
     * cache with keys that never hit is not.
     */
    describe("declines to cache a custom range", () => {
        const custom: TimeRange = {
            type: "custom",
            from: "2026-08-20T00:00:00Z",
            to: "2026-08-21T00:00:00Z",
        };

        it("queries again for an identical custom range", async () => {
            await cachedTopMessages(P1, custom);
            const afterFirst = queryCount();

            await cachedTopMessages(P1, custom);

            expect(queryCount()).toBeGreaterThan(afterFirst);
        });

        it("still returns the data", async () => {
            executeMock.mockResolvedValue([
                {
                    message: "boom",
                    count: "3",
                    latest_at: new Date(),
                    n_debug: 0,
                    n_info: 0,
                    n_warn: 0,
                    n_error: 3,
                    n_fatal: 0,
                },
            ]);

            await expect(cachedTopMessages(P1, custom)).resolves.toHaveLength(1);
        });
    });

    describe("failure handling", () => {
        it("propagates a query failure instead of caching it", async () => {
            executeMock.mockRejectedValue(new Error("db down"));

            await expect(cachedTopMessages(P1, HOUR)).rejects.toThrow("db down");
        });

        it("retries after a failure rather than serving nothing forever", async () => {
            executeMock.mockRejectedValueOnce(new Error("transient"));
            await expect(cachedTopSources(P1, HOUR)).rejects.toThrow("transient");

            executeMock.mockResolvedValue([{ source: "api", count: "4" }]);

            await expect(cachedTopSources(P1, HOUR)).resolves.toEqual([
                { source: "api", count: 4 },
            ]);
        });
    });

    it("clears every cache", async () => {
        await cachedTopSources(P1, HOUR);
        const afterFirst = queryCount();

        clearDashboardCaches();
        await cachedTopSources(P1, HOUR);

        expect(queryCount()).toBeGreaterThan(afterFirst);
    });
});
