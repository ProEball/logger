import { sql } from "drizzle-orm";
import { db } from "@/core/db/client";
import { rollupBoundary } from "@/shared/services/rollup-boundary.service";
import type { TimeRange } from "@/features/events/utils/event-filters.types";
import type { Event } from "@/core/db/schema";
import { resolveRange, pickBucket, fillBuckets, BUCKET_SECONDS } from "@/features/dashboard/utils/aggregation-utils";
import type { BucketRow } from "@/features/dashboard/utils/aggregation-utils";
import { pickDominantLevel, type EventLevel } from "@/features/dashboard/utils/dominant-level";

// Re-export pure helpers so callers can import from one place.
export { resolveRange, pickBucket, fillBuckets } from "@/features/dashboard/utils/aggregation-utils";
export type { BucketSize, BucketRow } from "@/features/dashboard/utils/aggregation-utils";

export type SourceCount = {
    source: string;
    count: number;
};

// ─── Result types ─────────────────────────────────────────────────────────────

export type LevelCount = {
    level: string;
    count: number;
};

export type TopMessage = {
    message: string;
    count: number;
    latestAt: Date;
    dominantLevel: EventLevel;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * db.execute() passes values raw to postgres.js, which cannot serialize Date
 * objects for parameterized queries. Convert to ISO string + cast to timestamptz
 * so the driver sends a plain string and PostgreSQL casts it correctly.
 */
function toTs(d: Date): ReturnType<typeof sql> {
    return sql`${d.toISOString()}::timestamptz`;
}

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * Events aggregated by time bucket + level.
 * Returns one BucketRow per time bucket; byLevel maps level→count.
 */
/**
 * The union query behind {@link eventsPerMinute}, split out so both stay inside
 * §3's 40-line limit. Everything here is one SQL literal; the shaping of its
 * rows into `BucketRow[]` is the caller's job.
 *
 * `date_trunc` only accepts unit names like 'minute'/'hour', not '5m'/'4h', so
 * bucketing is epoch-floor arithmetic — it works for any width in seconds.
 * `BUCKET_SECONDS` is a controlled constant, safe to inline as a raw SQL
 * integer.
 */
async function bucketedLevelCounts(
    projectId: string,
    from: Date,
    to: Date,
    secs: number,
    boundary: Date,
) {
    return db.execute<{ ts: Date; level: string; cnt: string }>(sql`
        WITH rolled AS (
            SELECT
                to_timestamp(floor(extract(epoch from minute) / ${sql.raw(String(secs))}) * ${sql.raw(String(secs))}) AS ts,
                key   AS level,
                SUM(value::int)::int AS n
            FROM event_rollup_minutes, jsonb_each_text(by_level)
            WHERE project_id = ${projectId}
              AND minute >= ${toTs(from)}
              AND minute <  LEAST(${toTs(to)}, ${toTs(boundary)})
            GROUP BY 1, 2
        ),
        fresh AS (
            SELECT
                to_timestamp(floor(extract(epoch from timestamp) / ${sql.raw(String(secs))}) * ${sql.raw(String(secs))}) AS ts,
                level,
                COUNT(*)::int AS n
            FROM events
            WHERE project_id = ${projectId}
              AND timestamp >= GREATEST(${toTs(from)}, ${toTs(boundary)})
              AND timestamp <  ${toTs(to)}
            GROUP BY 1, 2
        )
        SELECT ts, level, SUM(n)::text AS cnt
        FROM (SELECT * FROM rolled UNION ALL SELECT * FROM fresh) combined
        GROUP BY ts, level
        ORDER BY ts ASC
    `);
}

/**
 * Events aggregated by time bucket and level.
 *
 * Rollup below the watermark, raw events above it. `by_level` holds the
 * per-minute counts this needs, so no migration was required — the same table
 * the org overview reads (`PLAN.md` §16.2 item 5). Bucketing happens on the
 * union rather than in the rollup, because every width the UI asks for is a
 * multiple of a minute; storing anything coarser would fix the chart's
 * resolution at write time.
 */
export async function eventsPerMinute(
    projectId: string,
    range: TimeRange,
): Promise<BucketRow[]> {
    const { from, to } = resolveRange(range);
    const bucketSize = pickBucket(from, to);
    const secs = BUCKET_SECONDS[bucketSize];
    const boundary = (await rollupBoundary([projectId])) ?? from;

    const rows = await bucketedLevelCounts(projectId, from, to, secs, boundary);

    // Collapse flat (ts, level, cnt) rows into BucketRow[]
    const bucketMap = new Map<string, BucketRow>();
    for (const row of rows) {
        const key = new Date(row.ts).toISOString();
        if (!bucketMap.has(key)) {
            bucketMap.set(key, { ts: new Date(row.ts), total: 0, byLevel: {} });
        }
        const entry = bucketMap.get(key)!;
        const n = Number(row.cnt);
        entry.total += n;
        entry.byLevel[row.level] = (entry.byLevel[row.level] ?? 0) + n;
    }

    return fillBuckets(Array.from(bucketMap.values()), from, to, bucketSize);
}

/**
 * Count of events grouped by level for the given range.
 */
export async function levelBreakdown(
    projectId: string,
    range: TimeRange,
): Promise<LevelCount[]> {
    const { from, to } = resolveRange(range);

    const boundary = (await rollupBoundary([projectId])) ?? from;

    const rows = await db.execute<{ level: string; count: string }>(sql`
        WITH rolled AS (
            SELECT key AS level, SUM(value::int)::int AS n
            FROM event_rollup_minutes, jsonb_each_text(by_level)
            WHERE project_id = ${projectId}
              AND minute >= ${toTs(from)}
              AND minute <  LEAST(${toTs(to)}, ${toTs(boundary)})
            GROUP BY key
        ),
        fresh AS (
            SELECT level, COUNT(*)::int AS n
            FROM events
            WHERE project_id = ${projectId}
              AND timestamp >= GREATEST(${toTs(from)}, ${toTs(boundary)})
              AND timestamp <  ${toTs(to)}
            GROUP BY level
        )
        SELECT level, SUM(n)::text AS count
        FROM (SELECT * FROM rolled UNION ALL SELECT * FROM fresh) combined
        GROUP BY level
        -- ORDER BY the aggregate, never the output alias. The name 'count' is
        -- a text column here, and Postgres resolves an ORDER BY name against
        -- the select list first -- so this sorted lexicographically until
        -- 2026-08-21 and ranked 9 above 10. It stayed invisible because
        -- LevelBreakdownWidget re-sorts on the client: the data was wrong and
        -- the page looked right.
        ORDER BY SUM(n) DESC
    `);

    return rows.map((r) => ({ level: r.level, count: Number(r.count) }));
}

/**
 * Top N most frequent messages.
 * Messages are truncated to 200 chars for grouping to avoid cardinality explosion.
 */
export async function topMessages(
    projectId: string,
    range: TimeRange,
    limit = 10,
): Promise<TopMessage[]> {
    const { from, to } = resolveRange(range);

    // Five plain counters instead of `mode() WITHIN GROUP (ORDER BY level)`.
    // That was an *ordered-set* aggregate, and one in the select list forbids
    // `HashAggregate` outright, at any `work_mem` — it pinned this query to
    // sort-then-group over every matching row. Measured on staging at 8.9M
    // events over a 7-day range: 26,855 ms with it, 17,021 ms without, the plan
    // gaining `Partial HashAggregate`, one batch, no spill. `COUNT(*) FILTER`
    // is an ordinary aggregate and hashes fine. See `PLAN.md` §16.3.
    //
    // The level list is restated here rather than derived, because building it
    // from `EVENT_LEVELS` would mean generating aliases into raw SQL for a
    // fixed five-element enum. The drift that costs is covered instead by a
    // test that iterates `EVENT_LEVELS` and fails if any level is missing.
    const rows = await db.execute<
        { message: string; count: string; latest_at: Date } & Record<string, unknown>
    >(sql`
        SELECT
            SUBSTRING(message, 1, 200)                         AS message,
            COUNT(*)::text                                     AS count,
            MAX(timestamp)                                     AS latest_at,
            COUNT(*) FILTER (WHERE level = 'debug')::int       AS n_debug,
            COUNT(*) FILTER (WHERE level = 'info')::int        AS n_info,
            COUNT(*) FILTER (WHERE level = 'warn')::int        AS n_warn,
            COUNT(*) FILTER (WHERE level = 'error')::int       AS n_error,
            COUNT(*) FILTER (WHERE level = 'fatal')::int       AS n_fatal
        FROM events
        WHERE project_id = ${projectId}
          AND timestamp >= ${toTs(from)}
          AND timestamp <  ${toTs(to)}
        GROUP BY SUBSTRING(message, 1, 200)
        ORDER BY COUNT(*) DESC
        LIMIT ${limit}
    `);

    return rows.map((r) => ({
        message: r.message,
        count: Number(r.count),
        latestAt: new Date(r.latest_at),
        dominantLevel: pickDominantLevel({
            debug: Number(r.n_debug ?? 0),
            info: Number(r.n_info ?? 0),
            warn: Number(r.n_warn ?? 0),
            error: Number(r.n_error ?? 0),
            fatal: Number(r.n_fatal ?? 0),
        }),
    }));
}

// Raw row shape returned by postgres.js for snake_case columns
type RawEventRow = {
    id: string;
    project_id: string;
    timestamp: Date;
    level: string;
    message: string;
    source: string | null;
    environment: string | null;
    release: string | null;
    user_id: string | null;
    session_id: string | null;
    request_id: string | null;
    trace_id: string | null;
    error_type: string | null;
    stack_trace: string | null;
    attributes: Record<string, unknown> | null;
    context: Record<string, unknown> | null;
    user_agent: string | null;
    ip: string | null;
};

/**
 * Most recent error/fatal events.
 */
export async function recentErrors(
    projectId: string,
    range: TimeRange,
    limit = 10,
): Promise<Event[]> {
    const { from, to } = resolveRange(range);

    const rows = await db.execute<RawEventRow>(sql`
        SELECT id, project_id, timestamp, level, message, source, environment,
               release, user_id, session_id, request_id, trace_id, error_type,
               stack_trace, attributes, context, user_agent, ip
        FROM events
        WHERE project_id = ${projectId}
          AND timestamp >= ${toTs(from)}
          AND timestamp <  ${toTs(to)}
          AND level IN ('error', 'fatal')
        ORDER BY timestamp DESC
        LIMIT ${limit}
    `);

    return rows.map((r) => ({
        id: r.id,
        projectId: r.project_id,
        timestamp: new Date(r.timestamp),
        level: r.level,
        message: r.message,
        source: r.source,
        environment: r.environment,
        release: r.release,
        userId: r.user_id,
        sessionId: r.session_id,
        requestId: r.request_id,
        traceId: r.trace_id,
        errorType: r.error_type,
        stackTrace: r.stack_trace,
        attributes: r.attributes,
        context: r.context,
        userAgent: r.user_agent,
        ip: r.ip,
    })) as Event[];
}

/**
 * Top N event sources (the `source` field) by event count.
 */
export async function topSources(
    projectId: string,
    range: TimeRange,
    limit = 10,
): Promise<SourceCount[]> {
    const { from, to } = resolveRange(range);

    const rows = await db.execute<{ source: string; count: string }>(sql`
        SELECT COALESCE(source, '(unknown)') AS source, COUNT(*)::text AS count
        FROM events
        WHERE project_id = ${projectId}
          AND timestamp >= ${toTs(from)}
          AND timestamp <  ${toTs(to)}
        GROUP BY COALESCE(source, '(unknown)')
        -- Same defect as levelBreakdown, and worse here: with a LIMIT, a
        -- lexicographic sort returns the wrong ROWS, not merely the wrong
        -- order. A source with 10 events ranked below every source with 2
        -- through 9 and fell off the end of the list.
        ORDER BY COUNT(*) DESC
        LIMIT ${limit}
    `);

    return rows.map((r) => ({ source: r.source, count: Number(r.count) }));
}

/**
 * True if the project has at least one event ever (across all partitions).
 * Used to decide whether to show the empty-project onboarding CTA.
 */
export async function hasAnyEvents(projectId: string): Promise<boolean> {
    // Checks the rollup first: one row per minute is a far smaller haystack
    // than the partitioned event table, and any rollup row at all proves events
    // existed. `events` is still consulted, because a project whose first event
    // arrived in the last minute has no rollup row yet and is emphatically not
    // an empty project — showing it the onboarding screen would be the worst
    // possible moment to do so.
    const [row] = await db.execute<{ has_events: boolean }>(sql`
        SELECT (
            EXISTS (SELECT 1 FROM event_rollup_minutes WHERE project_id = ${projectId} LIMIT 1)
            OR
            EXISTS (SELECT 1 FROM events WHERE project_id = ${projectId} LIMIT 1)
        ) AS has_events
    `);
    return row?.has_events ?? false;
}
