/**
 * A bounded, in-process cache with single-flight recomputation and
 * stale-while-revalidate.
 *
 * It exists for one shape of problem: many concurrent readers asking for the
 * *same* expensive answer. The org overview is the motivating case — a hundred
 * dashboards open on one organization all want the identical aggregate, and
 * computing it once per viewer costs ~2 s of database CPU per page load
 * (`PLAN.md` §16.1). Serving one computation to all of them is not an
 * optimisation of that query; it removes the need to run it a hundred times.
 *
 * Three properties matter, and each exists because of a specific failure:
 *
 * 1. **Single flight.** When an entry is missing, concurrent callers share one
 *    computation instead of starting one each. Without this a cache makes the
 *    stampede *worse*: every reader misses at the same instant and the database
 *    receives the full hundred queries it was supposed to be spared.
 *
 * 2. **Stale while revalidating.** Past `ttlMs` the stored value is returned
 *    immediately and a refresh runs in the background. A viewer never waits for
 *    a recomputation that someone else's page load could have absorbed.
 *
 * 3. **A hard staleness ceiling.** Past `maxStaleMs` the value is no longer
 *    served and the caller blocks on a fresh computation. Without it, a
 *    database that has been down for an hour is indistinguishable from one
 *    that is up: the page keeps rendering hour-old numbers with no indication
 *    that anything is wrong, which is worse than an error boundary.
 *
 * **The stored value is shared by reference.** Every caller within one TTL
 * window receives the same object. Callers must treat it as immutable — a
 * consumer that sorts the returned array in place corrupts it for everyone
 * else holding it. Copying on read was rejected: the cached payloads here are
 * small but not free, and a copy on every one of a hundred reads reintroduces
 * per-reader cost for a hazard a comment can prevent.
 *
 * Deliberately in-process, not shared across instances. At the scale this was
 * built for — one deployable, ~100 concurrent readers — a per-instance cache
 * costs one recomputation per instance per TTL, which is nothing. Reach for an
 * external store only when the instance count makes that arithmetic stop
 * working; see `PLAN.md` §17 for why Redis stayed out of the stack.
 */

export type TtlCacheOptions = {
    /** Age past which a stored value is refreshed in the background. */
    ttlMs: number;
    /**
     * Age past which a stored value is no longer served at all. May not be
     * *below* `ttlMs`; the gap between the two is the window in which serving
     * stale happens.
     *
     * Setting the two **equal** is legal and closes that window completely:
     * the fresh test (`age < ttlMs`) and the expired test (`age >= maxStaleMs`)
     * then partition every possible age between them, so the stale branch is
     * unreachable and the cache degrades to single-flight only. That is not a
     * degenerate case to guard against — `readCacheSettings()` depends on it
     * under e2e.
     */
    maxStaleMs: number;
    /** Entries retained; the oldest is evicted past this. Defaults to 200. */
    maxEntries?: number;
    /** Injectable clock. The real one is a system boundary, so tests replace it. */
    now?: () => number;
    /**
     * Called when a *background* refresh fails. The foreground path propagates
     * its error to the caller instead; a background failure has no caller left
     * to receive it, and swallowing it silently would violate §9.
     */
    onBackgroundError?: (key: string, error: unknown) => void;
};

type Entry<T> = { value: T; computedAt: number };

export interface TtlCache<T> {
    /**
     * Returns the value for `key`, computing it with `compute` when there is
     * nothing fresh enough to serve. `compute` may not run at all.
     */
    get(key: string, compute: () => Promise<T>): Promise<T>;
    /** Entries currently held. For tests and diagnostics. */
    size(): number;
    /** Drops everything, including in-flight bookkeeping. For tests. */
    clear(): void;
}

export function createTtlCache<T>(options: TtlCacheOptions): TtlCache<T> {
    const { ttlMs, maxStaleMs, maxEntries = 200, now = Date.now, onBackgroundError } = options;

    if (ttlMs <= 0) throw new Error("ttlMs must be positive");
    if (maxStaleMs < ttlMs) throw new Error("maxStaleMs must be >= ttlMs");
    if (maxEntries <= 0) throw new Error("maxEntries must be positive");

    const entries = new Map<string, Entry<T>>();
    const inFlight = new Map<string, Promise<T>>();

    /**
     * Runs `compute` under `key`, de-duplicating concurrent callers. The
     * in-flight entry is removed in `finally` so a failure does not wedge the
     * key permanently — the next caller retries rather than awaiting a promise
     * that has already rejected.
     */
    function run(key: string, compute: () => Promise<T>): Promise<T> {
        const existing = inFlight.get(key);
        if (existing) return existing;

        const promise = compute()
            .then((value) => {
                store(key, value);
                return value;
            })
            .finally(() => {
                inFlight.delete(key);
            });

        inFlight.set(key, promise);
        return promise;
    }

    function store(key: string, value: T): void {
        entries.set(key, { value, computedAt: now() });
        evictOldest();
    }

    /**
     * Evicts by age of computation rather than by last read. A read-ordered
     * (LRU) policy would need bookkeeping on the hot path to protect entries
     * that are, by construction, about to be recomputed anyway.
     */
    function evictOldest(): void {
        while (entries.size > maxEntries) {
            let oldestKey: string | null = null;
            let oldestAt = Infinity;
            for (const [key, entry] of entries) {
                if (entry.computedAt < oldestAt) {
                    oldestAt = entry.computedAt;
                    oldestKey = key;
                }
            }
            if (oldestKey === null) return;
            entries.delete(oldestKey);
        }
    }

    function refreshInBackground(key: string, compute: () => Promise<T>): void {
        if (inFlight.has(key)) return;
        run(key, compute).catch((error: unknown) => {
            // The stored entry is deliberately left in place: a failed refresh
            // should not discard a value that is still inside `maxStaleMs`.
            onBackgroundError?.(key, error);
        });
    }

    return {
        get(key, compute) {
            const entry = entries.get(key);
            if (!entry) return run(key, compute);

            const age = now() - entry.computedAt;
            if (age < ttlMs) return Promise.resolve(entry.value);
            if (age >= maxStaleMs) return run(key, compute);

            refreshInBackground(key, compute);
            return Promise.resolve(entry.value);
        },
        size: () => entries.size,
        clear: () => {
            entries.clear();
            inFlight.clear();
        },
    };
}
