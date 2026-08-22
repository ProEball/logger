import { describe, it, expect, vi } from "vitest";
import { createTtlCache } from "./ttl-cache";

/**
 * The clock is a system boundary, so it is replaced rather than waited on —
 * a test that measures a 30-second TTL by sleeping for 30 seconds is not a
 * test anyone runs twice.
 */
function fakeClock(start = 1_000_000) {
    let current = start;
    return {
        now: () => current,
        advance: (ms: number) => {
            current += ms;
        },
    };
}

/** Lets queued microtasks (a background refresh) settle. */
async function flush() {
    for (let i = 0; i < 5; i++) await Promise.resolve();
}

const OPTIONS = { ttlMs: 1_000, maxStaleMs: 10_000 };

describe("createTtlCache", () => {
    it("computes on a miss and returns the value", async () => {
        const cache = createTtlCache<string>(OPTIONS);
        const compute = vi.fn().mockResolvedValue("fresh");

        await expect(cache.get("k", compute)).resolves.toBe("fresh");
        expect(compute).toHaveBeenCalledTimes(1);
    });

    it("serves a stored value without recomputing while it is fresh", async () => {
        const clock = fakeClock();
        const cache = createTtlCache<string>({ ...OPTIONS, now: clock.now });
        const compute = vi.fn().mockResolvedValue("v");

        await cache.get("k", compute);
        clock.advance(999);
        await expect(cache.get("k", compute)).resolves.toBe("v");

        expect(compute).toHaveBeenCalledTimes(1);
    });

    it("keeps keys independent", async () => {
        const cache = createTtlCache<string>(OPTIONS);

        await expect(cache.get("a", async () => "A")).resolves.toBe("A");
        await expect(cache.get("b", async () => "B")).resolves.toBe("B");
        expect(cache.size()).toBe(2);
    });

    describe("single flight", () => {
        it("collapses concurrent misses into one computation", async () => {
            const cache = createTtlCache<string>(OPTIONS);
            let release: (v: string) => void = () => {};
            const compute = vi.fn(
                () =>
                    new Promise<string>((resolve) => {
                        release = resolve;
                    }),
            );

            const all = Promise.all([
                cache.get("k", compute),
                cache.get("k", compute),
                cache.get("k", compute),
            ]);
            release("once");

            expect(await all).toEqual(["once", "once", "once"]);
            expect(compute).toHaveBeenCalledTimes(1);
        });

        it("does not start a second refresh while one is already running", async () => {
            const clock = fakeClock();
            const cache = createTtlCache<string>({ ...OPTIONS, now: clock.now });
            let release: (v: string) => void = () => {};
            const slow = vi.fn(
                () =>
                    new Promise<string>((resolve) => {
                        release = resolve;
                    }),
            );

            await cache.get("k", async () => "old");
            clock.advance(2_000);

            await cache.get("k", slow);
            await cache.get("k", slow);
            release("new");
            await flush();

            expect(slow).toHaveBeenCalledTimes(1);
        });
    });

    describe("staleness boundaries", () => {
        it("treats an age of exactly ttlMs as stale", async () => {
            const clock = fakeClock();
            const cache = createTtlCache<string>({ ...OPTIONS, now: clock.now });
            const compute = vi.fn().mockResolvedValueOnce("old").mockResolvedValueOnce("new");

            await cache.get("k", compute);
            clock.advance(1_000);

            // The stale value is what this call receives; the refresh is behind it.
            await expect(cache.get("k", compute)).resolves.toBe("old");
            await flush();
            expect(compute).toHaveBeenCalledTimes(2);
        });

        it("serves the refreshed value once the background refresh lands", async () => {
            const clock = fakeClock();
            const cache = createTtlCache<string>({ ...OPTIONS, now: clock.now });
            const compute = vi.fn().mockResolvedValueOnce("old").mockResolvedValueOnce("new");

            await cache.get("k", compute);
            clock.advance(2_000);
            await cache.get("k", compute);
            await flush();

            await expect(cache.get("k", compute)).resolves.toBe("new");
            expect(compute).toHaveBeenCalledTimes(2);
        });

        it("blocks on a fresh computation once maxStaleMs is reached", async () => {
            const clock = fakeClock();
            const cache = createTtlCache<string>({ ...OPTIONS, now: clock.now });
            const compute = vi.fn().mockResolvedValueOnce("old").mockResolvedValueOnce("new");

            await cache.get("k", compute);
            clock.advance(10_000);

            await expect(cache.get("k", compute)).resolves.toBe("new");
        });

        it("still serves stale one millisecond below maxStaleMs", async () => {
            const clock = fakeClock();
            const cache = createTtlCache<string>({ ...OPTIONS, now: clock.now });
            const compute = vi.fn().mockResolvedValueOnce("old").mockResolvedValueOnce("new");

            await cache.get("k", compute);
            clock.advance(9_999);

            await expect(cache.get("k", compute)).resolves.toBe("old");
        });
    });

    describe("failure handling", () => {
        it("propagates a foreground failure instead of caching it", async () => {
            const cache = createTtlCache<string>(OPTIONS);

            await expect(
                cache.get("k", async () => {
                    throw new Error("db down");
                }),
            ).rejects.toThrow("db down");
            expect(cache.size()).toBe(0);
        });

        it("retries after a foreground failure rather than wedging the key", async () => {
            const cache = createTtlCache<string>(OPTIONS);
            const compute = vi
                .fn()
                .mockRejectedValueOnce(new Error("transient"))
                .mockResolvedValueOnce("recovered");

            await expect(cache.get("k", compute)).rejects.toThrow("transient");
            await expect(cache.get("k", compute)).resolves.toBe("recovered");
        });

        it("keeps the stale value when a background refresh fails", async () => {
            const clock = fakeClock();
            const onBackgroundError = vi.fn();
            const cache = createTtlCache<string>({ ...OPTIONS, now: clock.now, onBackgroundError });
            const compute = vi
                .fn()
                .mockResolvedValueOnce("old")
                .mockRejectedValueOnce(new Error("db down"));

            await cache.get("k", compute);
            clock.advance(2_000);
            await expect(cache.get("k", compute)).resolves.toBe("old");
            await flush();

            expect(onBackgroundError).toHaveBeenCalledWith("k", expect.any(Error));

            // The entry survived the failed refresh: the next reader is still
            // served "old" rather than being made to wait for the database
            // that just failed.
            const retry = vi.fn().mockResolvedValue("recovered");
            await expect(cache.get("k", retry)).resolves.toBe("old");
        });
    });

    describe("bounds", () => {
        it("evicts the oldest entry past maxEntries", async () => {
            const clock = fakeClock();
            const cache = createTtlCache<string>({ ...OPTIONS, maxEntries: 2, now: clock.now });

            await cache.get("a", async () => "A");
            clock.advance(1);
            await cache.get("b", async () => "B");
            clock.advance(1);
            await cache.get("c", async () => "C");

            expect(cache.size()).toBe(2);
            // "a" was evicted, so this recomputes rather than hitting the cache.
            const recompute = vi.fn().mockResolvedValue("A2");
            await expect(cache.get("a", recompute)).resolves.toBe("A2");
            expect(recompute).toHaveBeenCalledTimes(1);
        });

        it("clears everything", async () => {
            const cache = createTtlCache<string>(OPTIONS);
            await cache.get("k", async () => "v");
            cache.clear();
            expect(cache.size()).toBe(0);
        });

        it.each([
            ["ttlMs is zero", { ttlMs: 0, maxStaleMs: 10 }],
            ["ttlMs is negative", { ttlMs: -1, maxStaleMs: 10 }],
            ["maxStaleMs is below ttlMs", { ttlMs: 100, maxStaleMs: 99 }],
            ["maxEntries is zero", { ttlMs: 1, maxStaleMs: 1, maxEntries: 0 }],
        ])("rejects options where %s", (_label, bad) => {
            expect(() => createTtlCache(bad)).toThrow();
        });

        it("accepts maxStaleMs equal to ttlMs", () => {
            expect(() => createTtlCache({ ttlMs: 100, maxStaleMs: 100 })).not.toThrow();
        });

        /**
         * Equal values close the stale window entirely: `age < ttlMs` and
         * `age >= maxStaleMs` then partition every possible age, leaving the
         * background-refresh branch unreachable. That is not a curiosity —
         * `readCacheSettings()` uses exactly this shape under e2e to keep
         * specs deterministic, and a doc comment claiming the refresh branch
         * still ran there is what an audit caught on 2026-08-20.
         */
        it("has no stale window when maxStaleMs equals ttlMs", async () => {
            const clock = fakeClock();
            const cache = createTtlCache<string>({ ttlMs: 1, maxStaleMs: 1, now: clock.now });
            const compute = vi.fn().mockResolvedValueOnce("old").mockResolvedValueOnce("new");

            await cache.get("k", compute);
            clock.advance(1);

            // Not "old" with a refresh behind it — the caller waits for the new value.
            await expect(cache.get("k", compute)).resolves.toBe("new");
        });
    });
});
