/**
 * How long a cached read is served, and for how long past that it may still
 * be served while a refresh is failing.
 *
 * Shared by the org overview and the project dashboard. It lived in the
 * overview until 2026-08-21, which meant `features/dashboard` had to import
 * from `features/overview` to reuse it -- a §2.1 violation, and the wrong
 * shape besides: this is a policy about caching, not about either page.
 */

/**
 * Cache timings, as a function of whether this is the e2e server.
 *
 * **Live values.** The TTL matches the shortest auto-refresh interval a viewer
 * can choose, so a reader on 30s never sees the same numbers twice running
 * purely because of caching. Going lower buys freshness the rollup cannot
 * supply anyway — it rebuilds once a minute — while multiplying recomputations
 * of the uncached tail. The ceiling of five minutes is ten refresh attempts:
 * long enough that a restart or a brief database blip is invisible, short
 * enough that a sustained outage surfaces as an error rather than as a
 * dashboard confidently showing numbers from before it broke.
 *
 * **Under e2e both collapse to 1 ms**, making it impossible for a spec to be
 * served a value another spec caused. Be precise about the cost: single flight
 * and the ceiling stay in the path, but with `ttlMs === maxStaleMs` the two
 * age tests in `TtlCache.get` partition every age between them, so the
 * **stale-while-revalidate branch is unreachable here**. Determinism in the
 * specs is worth more than exercising that branch end to end, and
 * `ttl-cache.test.ts` covers it directly. The hazard being avoided is
 * specific and would be nasty: an e2e test that ingests events and then asserts
 * on the overview would be served the previous test's numbers, fail with
 * figures that look plausible rather than wrong, and offer nothing pointing at
 * a cache. Today's specs happen to avoid it by giving each one its own
 * organization, so the keys never collide — which is luck, not a guarantee,
 * and not something the next person writing a spec would know to preserve.
 *
 * Both must shrink together: a 1 ms TTL with a five-minute ceiling would still
 * serve stale values for five minutes, just from the background-refresh branch
 * instead of the fresh one.
 */
export function readCacheSettings(isE2E: boolean): { ttlMs: number; maxStaleMs: number } {
    if (isE2E) return { ttlMs: 1, maxStaleMs: 1 };
    return { ttlMs: 30_000, maxStaleMs: 5 * 60_000 };
}

