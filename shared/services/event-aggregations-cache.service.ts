import { logger } from "@/core/logger";
import { createTtlCache } from "@/shared/utils/ttl-cache";
import { queryCacheKey } from "@/shared/utils/query-cache-key";
import { readCacheSettings, readLiveCacheSettings } from "@/shared/utils/read-cache-settings";
import {
    emptyBucket,
    emptyLevelledBucket,
    fillBuckets,
    type EventBucket,
    type LevelledBucket,
} from "@/shared/utils/event-buckets";
import {
    environmentsInUse,
    eventBuckets,
    eventsInLastMinute,
    eventBucketsByLevel,
    levelBreakdown,
    projectStats,
    recentErrors,
    topMessagePerProject,
    topMessages,
    topSources,
    type DateRange,
    type LevelCount,
    type ProjectStats,
    type ProjectTopMessage,
    type SourceCount,
    type TopMessage,
} from "@/shared/services/event-aggregations.service";
import type { EventLevel } from "@/shared/utils/dominant-level";
import type { Event } from "@/core/db/schema";

/**
 * A read-through cache in front of `event-aggregations.service.ts`.
 *
 * **Why it exists.** Measured on staging at 1.3M events, one overview load costs
 * ~2 s of database CPU. That is survivable for one viewer and arithmetic that
 * does not work for a hundred: 100 readers on a 30-second refresh issue 200
 * loads a minute, which is ~6.8 cores of database time for **one answer computed
 * two hundred times**. Every reader of a scope asks the same question, so it is
 * answered once per TTL and shared. This is not a faster query — it is the
 * removal of 199 identical ones.
 *
 * **What it does not fix.** The cache bounds how *often* an expensive query
 * runs, not how expensive it is. A query that grows to ten seconds still costs
 * ten seconds every TTL, and the first reader after `maxStaleMs` waits for it.
 *
 * ## One cache, two pages (2026-08-25)
 *
 * This replaces `overview-cache.service.ts` and `dashboard-cache.service.ts`,
 * which were the same file twice: same primitive, same window, same key builder,
 * differing only in whether the scope was a list or one id.
 *
 * **Merging them exposed a latent collision.** The two files namespaced their
 * keys `overview.*` and `dashboard.*`, and that prefix was the *only* thing
 * keeping two different questions apart: the project dashboard asks
 * `topMessages` for every level with a limit of 10, the overview asks it for
 * `error, fatal` with a limit of 5, and **neither `levels` nor `limit` was in
 * the key**. One project's dashboard and a one-project organization would have
 * collided the moment the prefixes merged — served five error rows where ten
 * rows of every level were asked for.
 *
 * The fix is not to keep the prefixes. A key must be exactly as discriminating
 * as the query it stands in for (`query-cache-key.ts`), and a prefix that
 * happens to encode "which page asked" is discriminating by accident. So the two
 * questions get two named wrappers, and every option that changes the answer is
 * in the key.
 *
 * ## The cache key is a permission boundary
 *
 * `projectIds` is part of every key. Today that is belt-and-braces: every member
 * of an organization sees all of its projects. It is in the key because the day
 * per-project visibility arrives, a key that omitted it would not fail — it
 * would quietly serve one member's projects to another. See
 * `docs/reference/security.md`.
 *
 * ## Why the key carries the preset, not the range
 *
 * `resolveRange()` returns `to = new Date()`. A resolved range in the key would
 * make every key unique to the millisecond and the hit rate exactly zero — a
 * cache that never hits, costing memory and indirection to do nothing. The key
 * carries the *preset*; the resolved range is captured in the compute closure,
 * so a background refresh uses a range resolved microseconds earlier rather than
 * a stale one.
 *
 * ## What the merge dropped
 *
 * The project dashboard's cache carried a `cacheable()` guard that read straight
 * through for a **custom** range, on the reasoning that a resolved range in a key
 * never repeats. It is gone, and nothing is lost: these wrappers take the preset
 * as a separate argument rather than deriving it, so a caller cannot smuggle
 * timestamps into a key by passing a custom range. The overview's cache never
 * had the guard and shipped without it. Its two tests went with it, because they
 * asserted on a branch that no longer exists rather than on an outcome.
 *
 * `hasAnyEvents` is deliberately **not** here. It gates the onboarding screen,
 * so the one moment its answer changes — the first event a project ever receives
 * — is the one moment nobody should be shown a stale "no events yet". It costs
 * 0.79 ms.
 */

/** `E2E_MODE` is a raw `process.env` read by design — see `stack.md`. */
const SETTINGS = readCacheSettings(process.env.E2E_MODE === "true");

export const CACHE_TTL_MS = SETTINGS.ttlMs;
export const CACHE_MAX_STALE_MS = SETTINGS.maxStaleMs;

const CACHE_OPTIONS = {
    ttlMs: CACHE_TTL_MS,
    maxStaleMs: CACHE_MAX_STALE_MS,
    onBackgroundError: (key: string, error: unknown) => {
        logger.warn({ key, err: error }, "analytics cache background refresh failed");
    },
};

/**
 * One cache per query rather than one shared store. A single store would have to
 * be typed `unknown` and cast at each read, and `PROJECT.md` §4 does not allow a
 * cast whose only justification is that it was convenient.
 */
const bucketsCache = createTtlCache<EventBucket[]>(CACHE_OPTIONS);
const levelledBucketsCache = createTtlCache<LevelledBucket[]>(CACHE_OPTIONS);
const levelsCache = createTtlCache<LevelCount[]>(CACHE_OPTIONS);
const topMessagesCache = createTtlCache<TopMessage[]>(CACHE_OPTIONS);
const topErrorsCache = createTtlCache<TopMessage[]>(CACHE_OPTIONS);
const perProjectMessageCache = createTtlCache<Map<string, ProjectTopMessage>>(CACHE_OPTIONS);
const statsCache = createTtlCache<Map<string, ProjectStats>>(CACHE_OPTIONS);
const sourcesCache = createTtlCache<SourceCount[]>(CACHE_OPTIONS);
const recentErrorsCache = createTtlCache<Event[]>(CACHE_OPTIONS);
const environmentsCache = createTtlCache<string[]>(CACHE_OPTIONS);

/**
 * A second store on the live profile. Separate rather than a per-entry TTL
 * because `createTtlCache` takes its window once, and one store per policy is
 * clearer than one store whose entries expire on different rules.
 */
const LIVE = readLiveCacheSettings(process.env.E2E_MODE === "true");
const lastMinuteCache = createTtlCache<number>({
    ttlMs: LIVE.ttlMs,
    maxStaleMs: LIVE.maxStaleMs,
    onBackgroundError: CACHE_OPTIONS.onBackgroundError,
});

/** What the "top errors" widget ranks on. A constant, never request-supplied. */
export const TOP_ERROR_LEVELS: readonly EventLevel[] = ["error", "fatal"];

/**
 * Volume and level counts per project per bucket, zero-filled.
 *
 * Filling happens inside the cached compute rather than at each read, so the
 * zero rows are built once per TTL alongside the query. `bucketSecs` is in the
 * key: two widths are two different answers.
 */
export function cachedEventBuckets(
    projectIds: string[],
    preset: string,
    range: DateRange,
    bucketSecs: number,
    environments?: string[],
): Promise<EventBucket[]> {
    const key = queryCacheKey("eventBuckets", projectIds, preset, environments, bucketSecs);
    return bucketsCache.get(key, async () =>
        fillBuckets(
            await eventBuckets(projectIds, range, bucketSecs, environments),
            projectIds,
            range,
            bucketSecs,
            emptyBucket,
        ),
    );
}

/**
 * The same buckets **with per-level counts**, for the project dashboard's
 * stacked-area chart.
 *
 * A separate entry, and a separate query: the level breakdown costs roughly
 * eight times the plain totals — see `LevelledBucket`. Sharing one cache would
 * mean every org page paid for a breakdown it does not draw.
 */
export function cachedEventBucketsByLevel(
    projectIds: string[],
    preset: string,
    range: DateRange,
    bucketSecs: number,
    environments?: string[],
): Promise<LevelledBucket[]> {
    const key = queryCacheKey("eventBucketsByLevel", projectIds, preset, environments, bucketSecs);
    return levelledBucketsCache.get(key, async () =>
        fillBuckets(
            await eventBucketsByLevel(projectIds, range, bucketSecs, environments),
            projectIds,
            range,
            bucketSecs,
            emptyLevelledBucket,
        ),
    );
}

export function cachedLevelBreakdown(
    projectIds: string[],
    preset: string,
    range: DateRange,
    environments?: string[],
): Promise<LevelCount[]> {
    const key = queryCacheKey("levelBreakdown", projectIds, preset, environments);
    return levelsCache.get(key, () => levelBreakdown(projectIds, range, environments));
}

/**
 * Most frequent messages at **every** level.
 *
 * Separate from {@link cachedTopErrors} rather than one function with options,
 * because the two are different questions and the key must say so — see the
 * collision note at the top of this file.
 */
export function cachedTopMessages(
    projectIds: string[],
    preset: string,
    range: DateRange,
    environments?: string[],
    limit = 10,
): Promise<TopMessage[]> {
    const key = queryCacheKey("topMessages", projectIds, preset, environments, limit);
    return topMessagesCache.get(key, () =>
        topMessages(projectIds, range, { environments, limit }),
    );
}

/**
 * Most frequent **error and fatal** messages.
 *
 * `preset` here is whatever window the caller actually asked for — on the
 * overview that is the *clamped* top-errors window, not the page's range (see
 * `clampTopErrorsWindow`). Keying on the page preset would collide two different
 * questions onto one entry whenever the clamp fired.
 */
export function cachedTopErrors(
    projectIds: string[],
    preset: string,
    range: DateRange,
    environments?: string[],
    limit = 5,
): Promise<TopMessage[]> {
    const key = queryCacheKey("topErrors", projectIds, preset, environments, limit);
    return topErrorsCache.get(key, () =>
        topMessages(projectIds, range, { levels: TOP_ERROR_LEVELS, environments, limit }),
    );
}

/**
 * Cached separately from {@link cachedProjectStats}, and the separation is the
 * point: they were one entry until 2026-08-20, so the ~30 ms half could not be
 * served unless the ~954 ms half was ready too. Two entries let two `Suspense`
 * boundaries resolve independently.
 */
export function cachedTopMessagePerProject(
    projectIds: string[],
    preset: string,
    range: DateRange,
    environments?: string[],
): Promise<Map<string, ProjectTopMessage>> {
    const key = queryCacheKey("topMessagePerProject", projectIds, preset, environments);
    return perProjectMessageCache.get(key, () =>
        topMessagePerProject(projectIds, range, environments),
    );
}

export function cachedProjectStats(
    projectIds: string[],
    preset: string,
    range: DateRange,
    environments?: string[],
): Promise<Map<string, ProjectStats>> {
    const key = queryCacheKey("projectStats", projectIds, preset, environments);
    return statsCache.get(key, () => projectStats(projectIds, range, environments));
}

export function cachedTopSources(
    projectIds: string[],
    preset: string,
    range: DateRange,
    environments?: string[],
    limit = 10,
): Promise<SourceCount[]> {
    const key = queryCacheKey("topSources", projectIds, preset, environments, limit);
    return sourcesCache.get(key, () => topSources(projectIds, range, { environments, limit }));
}

export function cachedRecentErrors(
    projectIds: string[],
    preset: string,
    range: DateRange,
    environments?: string[],
    limit = 10,
): Promise<Event[]> {
    const key = queryCacheKey("recentErrors", projectIds, preset, environments, limit);
    return recentErrorsCache.get(key, () => recentErrors(projectIds, range, { environments, limit }));
}

/** Keyed on the scope alone: this read ignores the range, so a range change is a hit. */
export function cachedEnvironments(projectIds: string[]): Promise<string[]> {
    return environmentsCache.get(queryCacheKey("environmentsInUse", projectIds), () =>
        environmentsInUse(projectIds),
    );
}

/**
 * Events in the last minute — cached on its **own, shorter window**.
 *
 * Ten seconds rather than thirty. A range aggregate that is half a minute old is
 * indistinguishable from a fresh one; a "last minute" reading that is half a
 * minute old is describing a minute that has already ended. See
 * `readLiveCacheSettings`.
 *
 * No `preset` in the key: this reading ignores the page's range entirely, so a
 * range change is a cache hit rather than a miss.
 *
 * Called from `app/[org]/[project]/layout.tsx` — so every project page shares one
 * entry, and the environment argument is always absent. See `ProjectPulse`.
 */
export function cachedEventsInLastMinute(
    projectIds: string[],
    environments?: string[],
): Promise<number> {
    const key = queryCacheKey("eventsInLastMinute", projectIds, environments);
    return lastMinuteCache.get(key, () => eventsInLastMinute(projectIds, environments));
}


/** Drops every entry. Exists for tests; nothing in the app should need it. */
export function clearAnalyticsCaches(): void {
    bucketsCache.clear();
    levelledBucketsCache.clear();
    levelsCache.clear();
    topMessagesCache.clear();
    topErrorsCache.clear();
    perProjectMessageCache.clear();
    statsCache.clear();
    sourcesCache.clear();
    recentErrorsCache.clear();
    environmentsCache.clear();
    lastMinuteCache.clear();
}
