/**
 * A read-through cache in front of `overview.service.ts`.
 *
 * **Why this exists.** Measured on staging at 1.3M events, one overview page
 * load costs ~2 s of database CPU, ~96% of it in the two message-keyed
 * aggregations that the rollup cannot serve (`PLAN.md` §16.1). That is
 * survivable for one viewer and arithmetic that does not work for a hundred:
 * 100 readers on a 30-second refresh issue 200 loads a minute, which is ~6.8
 * cores of database time for **one answer computed two hundred times**.
 *
 * Every reader of an organization sees the same aggregate, so it is computed
 * once per TTL and shared. This is not a faster query — it is the removal of
 * 199 identical ones, and it is the difference between the page scaling with
 * readers and not scaling at all.
 *
 * **What it does not fix.** The cache bounds how *often* an expensive query
 * runs, not how expensive it is. A query that grows to ten seconds as data
 * accumulates still costs ten seconds of CPU every TTL, and the first reader
 * after `maxStaleMs` still waits for it. Making the message-keyed aggregations
 * cheap remains outstanding work, not work this replaced.
 *
 * ## The cache key is a permission boundary
 *
 * `projectIds` is part of every key. Today that is belt-and-braces: every
 * member of an organization sees all of its projects, so no two readers of the
 * same organization have different scopes. It is in the key because the day
 * per-project visibility arrives, a key that omitted it would not fail — it
 * would quietly serve one member's projects to another. A cache that is
 * correct only by accident of the current permission model is a latent leak,
 * so `shared/utils/query-cache-key.test.ts` asserts the separation directly.
 *
 * ## Why the key is built from the preset, not from the range
 *
 * `resolveRange()` returns `to = new Date()`. Putting a resolved range in the
 * key would make every key unique to the millisecond and the hit rate exactly
 * zero — a cache that never hits, costing memory and a layer of indirection to
 * do nothing. The key therefore carries the *preset* while the range is
 * resolved by the route and captured in the compute closure, so a background
 * refresh uses a range resolved microseconds earlier rather than a stale one.
 *
 * The route keeps calling `resolveRange()` because it lives in
 * `features/dashboard`, and a feature importing another feature violates
 * §2.1 where a route composing two of them does not — the same reasoning that
 * kept range resolution out of `overview-filters.ts`.
 */

import { logger } from "@/core/logger";
import { createTtlCache } from "@/shared/utils/ttl-cache";
import { readCacheSettings } from "@/shared/utils/read-cache-settings";
import { queryCacheKey } from "@/shared/utils/query-cache-key";
import {
    getProjectStats,
    getProjectTopMessages,
    getOrgTopErrors,
    getOrgLevelBreakdown,
    getOrgEnvironments,
    getOrgEventBuckets,
    type DateRange,
    type ProjectStats,
    type ProjectTopMessage,
    type OrgTopError,
    type OrgLevelCount,
    type OrgEventBucket,
} from "@/features/overview/services/overview.service";

/** `E2E_MODE` is a raw `process.env` read by design — see `stack.md`. */
const SETTINGS = readCacheSettings(process.env.E2E_MODE === "true");

export const OVERVIEW_CACHE_TTL_MS = SETTINGS.ttlMs;
export const OVERVIEW_CACHE_MAX_STALE_MS = SETTINGS.maxStaleMs;

const CACHE_OPTIONS = {
    ttlMs: OVERVIEW_CACHE_TTL_MS,
    maxStaleMs: OVERVIEW_CACHE_MAX_STALE_MS,
    onBackgroundError: (key: string, error: unknown) => {
        logger.warn({ key, err: error }, "overview cache background refresh failed");
    },
};

/**
 * One cache per query rather than one shared store. A single store would have
 * to be typed `unknown` and cast at each read, and §4 does not allow a cast
 * whose only justification is that it was convenient.
 */
const statsCache = createTtlCache<Map<string, ProjectStats>>(CACHE_OPTIONS);
const topMessagesCache = createTtlCache<Map<string, ProjectTopMessage>>(CACHE_OPTIONS);
const topErrorsCache = createTtlCache<OrgTopError[]>(CACHE_OPTIONS);
const levelBreakdownCache = createTtlCache<OrgLevelCount[]>(CACHE_OPTIONS);
const environmentsCache = createTtlCache<string[]>(CACHE_OPTIONS);
const bucketsCache = createTtlCache<OrgEventBucket[]>(CACHE_OPTIONS);

export function cachedProjectStats(
    projectIds: string[],
    preset: string,
    range: DateRange,
    environments?: string[],
): Promise<Map<string, ProjectStats>> {
    const key = queryCacheKey("overview.stats", projectIds, preset, environments);
    return statsCache.get(key, () => getProjectStats(projectIds, range, environments));
}

/**
 * Cached separately from the stats, and the separation is the point: they were
 * one entry until 2026-08-20, so the ~30 ms half could not be served unless the
 * ~954 ms half was ready too. Two entries let two `Suspense` boundaries resolve
 * independently.
 */
export function cachedProjectTopMessages(
    projectIds: string[],
    preset: string,
    range: DateRange,
    environments?: string[],
): Promise<Map<string, ProjectTopMessage>> {
    const key = queryCacheKey("overview.topMessages", projectIds, preset, environments);
    return topMessagesCache.get(key, () => getProjectTopMessages(projectIds, range, environments));
}

/**
 * `preset` here is the *clamped* top-errors window, not the page's range —
 * see `clampTopErrorsWindow`. Keying on the page preset would collide two
 * different questions onto one entry whenever the clamp fired.
 */
export function cachedOrgTopErrors(
    projectIds: string[],
    preset: string,
    range: DateRange,
    environments?: string[],
): Promise<OrgTopError[]> {
    const key = queryCacheKey("overview.topErrors", projectIds, preset, environments);
    return topErrorsCache.get(key, () => getOrgTopErrors(projectIds, range, environments));
}

export function cachedOrgLevelBreakdown(
    projectIds: string[],
    preset: string,
    range: DateRange,
    environments?: string[],
): Promise<OrgLevelCount[]> {
    const key = queryCacheKey("overview.levelBreakdown", projectIds, preset, environments);
    return levelBreakdownCache.get(key, () =>
        getOrgLevelBreakdown(projectIds, range, environments),
    );
}

export function cachedOrgEnvironments(projectIds: string[]): Promise<string[]> {
    const key = queryCacheKey("overview.environments", projectIds);
    return environmentsCache.get(key, () => getOrgEnvironments(projectIds));
}

export function cachedOrgEventBuckets(
    projectIds: string[],
    preset: string,
    range: DateRange,
    bucketSecs: number,
): Promise<OrgEventBucket[]> {
    const key = queryCacheKey("overview.buckets", projectIds, preset, undefined, bucketSecs);
    return bucketsCache.get(key, () => getOrgEventBuckets(projectIds, range, bucketSecs));
}

/** Drops every entry. Exists for tests; nothing in the app should need it. */
export function clearOverviewCaches(): void {
    statsCache.clear();
    topMessagesCache.clear();
    topErrorsCache.clear();
    levelBreakdownCache.clear();
    environmentsCache.clear();
    bucketsCache.clear();
}
