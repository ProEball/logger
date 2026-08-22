/**
 * A read-through cache in front of `aggregations.service.ts`.
 *
 * Same primitive and the same 30-second window as the org overview's
 * (`features/overview/services/overview-cache.service.ts`) — deliberately, so
 * there is one read pattern in this codebase rather than two. What differs is
 * only the scope: the overview's answers are per organization, these are per
 * project, so the key carries one project id instead of a list.
 *
 * **Why it is worth having here.** Measured 2026-08-21 against 500k events, a
 * dashboard load costs ~236 ms of database time across six queries, 170 ms of
 * it in `topMessages` alone (`aggregations.service.bench.ts`). That is fine for
 * one reader and does not survive a room full: every reader of a project asks
 * precisely the same question, so it is answered once per TTL and shared.
 *
 * The rollup (§16.2 item 5) and this cache attack different halves of that.
 * The rollup makes three of the six queries cheap; the cache makes all six
 * infrequent. Neither substitutes for the other, and neither touches
 * `topMessages`, which cannot leave raw `events` at all.
 *
 * The cache key carries the project id, which makes it an **authorization
 * boundary** — see `shared/utils/query-cache-key.ts` and the security note in
 * `docs/reference/security.md`. And it carries the range **preset**, never a
 * resolved range: `resolveRange()` returns `to = new Date()`, so a resolved
 * range would make every key unique to the millisecond and the hit rate exactly
 * zero.
 *
 * `hasAnyEvents` is deliberately **not** cached. It gates the onboarding screen,
 * so the one moment its answer changes — the first event a project ever
 * receives — is the one moment nobody should be shown a stale "no events yet".
 * It costs 0.79 ms.
 */

import { logger } from "@/core/logger";
import { createTtlCache } from "@/shared/utils/ttl-cache";
import { queryCacheKey } from "@/shared/utils/query-cache-key";
import { readCacheSettings } from "@/shared/utils/read-cache-settings";
import {
    eventsPerMinute,
    levelBreakdown,
    recentErrors,
    topMessages,
    topSources,
    type LevelCount,
    type SourceCount,
    type TopMessage,
} from "@/features/dashboard/services/aggregations.service";
import { dashboardRangePreset } from "@/features/dashboard/utils/dashboard-range";
import type { BucketRow } from "@/features/dashboard/utils/aggregation-utils";
import type { Event } from "@/core/db/schema";
import type { TimeRange } from "@/shared/utils/event-filters.schema";

const SETTINGS = readCacheSettings(process.env.E2E_MODE === "true");

const CACHE_OPTIONS = {
    ttlMs: SETTINGS.ttlMs,
    maxStaleMs: SETTINGS.maxStaleMs,
    onBackgroundError: (key: string, error: unknown) => {
        logger.warn({ key, err: error }, "dashboard cache background refresh failed");
    },
};

const bucketsCache = createTtlCache<BucketRow[]>(CACHE_OPTIONS);
const levelCache = createTtlCache<LevelCount[]>(CACHE_OPTIONS);
const topMessagesCache = createTtlCache<TopMessage[]>(CACHE_OPTIONS);
const recentErrorsCache = createTtlCache<Event[]>(CACHE_OPTIONS);
const topSourcesCache = createTtlCache<SourceCount[]>(CACHE_OPTIONS);

/**
 * A custom range is not cacheable — its key would carry resolved timestamps and
 * never repeat. Nothing reachable from a URL produces one
 * (`parseDashboardRange` only ever returns presets), so this is a guard against
 * a future caller rather than a path anyone takes today; it degrades to reading
 * straight through rather than filling the cache with keys that never hit.
 */
function cacheable(range: TimeRange): string | null {
    return dashboardRangePreset(range);
}

export function cachedEventsPerMinute(
    projectId: string,
    range: TimeRange,
): Promise<BucketRow[]> {
    const preset = cacheable(range);
    if (!preset) return eventsPerMinute(projectId, range);
    return bucketsCache.get(queryCacheKey("dashboard.buckets", [projectId], preset), () =>
        eventsPerMinute(projectId, range),
    );
}

export function cachedLevelBreakdown(projectId: string, range: TimeRange): Promise<LevelCount[]> {
    const preset = cacheable(range);
    if (!preset) return levelBreakdown(projectId, range);
    return levelCache.get(queryCacheKey("dashboard.levels", [projectId], preset), () =>
        levelBreakdown(projectId, range),
    );
}

/** The 170 ms one, and the reason the rest of this file is worth its weight. */
export function cachedTopMessages(projectId: string, range: TimeRange): Promise<TopMessage[]> {
    const preset = cacheable(range);
    if (!preset) return topMessages(projectId, range);
    return topMessagesCache.get(queryCacheKey("dashboard.topMessages", [projectId], preset), () =>
        topMessages(projectId, range),
    );
}

export function cachedRecentErrors(projectId: string, range: TimeRange): Promise<Event[]> {
    const preset = cacheable(range);
    if (!preset) return recentErrors(projectId, range);
    return recentErrorsCache.get(queryCacheKey("dashboard.recentErrors", [projectId], preset), () =>
        recentErrors(projectId, range),
    );
}

export function cachedTopSources(projectId: string, range: TimeRange): Promise<SourceCount[]> {
    const preset = cacheable(range);
    if (!preset) return topSources(projectId, range);
    return topSourcesCache.get(queryCacheKey("dashboard.topSources", [projectId], preset), () =>
        topSources(projectId, range),
    );
}

/** Drops every entry. Exists for tests; nothing in the app should need it. */
export function clearDashboardCaches(): void {
    bucketsCache.clear();
    levelCache.clear();
    topMessagesCache.clear();
    recentErrorsCache.clear();
    topSourcesCache.clear();
}
