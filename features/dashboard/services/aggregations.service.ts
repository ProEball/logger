import { sql } from "drizzle-orm";
import { db } from "@/core/db/client";
import { rollupBoundary, templateCoverage } from "@/shared/services/rollup-boundary.service";
import type { TimeRange } from "@/features/events/utils/event-filters.types";
import type { Event } from "@/core/db/schema";
import { resolveRange, pickBucket, fillBuckets, BUCKET_SECONDS } from "@/features/dashboard/utils/aggregation-utils";
import type { BucketRow } from "@/features/dashboard/utils/aggregation-utils";
import {
    pickDominantLevel,
    levelCounts,
    type EventLevel,
    type RollupLevelRow,
} from "@/shared/utils/dominant-level";

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

 * `topMessages` served from the template rollup.
 *
 * Rollup rows below the coverage ceiling, raw `events` above it — the same
 * union every other rollup-backed read uses. What differs is that the grouping
 * key is a `bigint` rather than 200 characters of text, which is the entire
 * point: the sort disappears and the work stops scaling with the number of
 * events.
 *
 * Measured on staging at 8.9M events over 7 days, the raw-text form reads
 * 4.5M rows and hashes 1.13M groups in ~17 s. This form reads ~899k rollup rows
 * and groups ~18k. `PLAN.md` §16.3 has the arithmetic.
 *
 * The caller has already established that `range` sits inside coverage; this
 * function does not re-check, because the decision needs the fallback branch
 * and belongs where both are visible.
 */
async function topMessagesFromRollup(
    projectId: string,
    from: Date,
    to: Date,
    boundary: Date,
    limit: number,
): Promise<TopMessage[]> {
    const rows = await db.execute<
        RollupLevelRow & { message: string; count: string; latest_at: Date }
    >(sql`
        WITH cells AS (
            -- Five int columns, so no lateral over jsonb and no JSON parse per
            -- row. That expansion measured 547 ms with 0% of it waiting on
            -- disk -- pure CPU, which is why the n_* columns exist.
            SELECT r.template_hash,
                   SUM(r.count)::int   AS total,
                   SUM(r.n_debug)::int AS n_debug,
                   SUM(r.n_info)::int  AS n_info,
                   SUM(r.n_warn)::int  AS n_warn,
                   SUM(r.n_error)::int AS n_error,
                   SUM(r.n_fatal)::int AS n_fatal,
                   MAX(r.latest_at)    AS latest
            FROM event_template_rollup r
            WHERE r.project_id = ${projectId}::uuid
              AND r.minute >= ${toTs(from)}
              AND r.minute <  ${toTs(boundary)}
            GROUP BY 1

            UNION ALL

            -- The tail: at minute grain this is at most one minute of events,
            -- which is why the grain was chosen. At hour grain it would be up
            -- to ~114,000 rows on every read.
            SELECT e.template_hash,
                   COUNT(*)::int,
                   COUNT(*) FILTER (WHERE e.level = 'debug')::int,
                   COUNT(*) FILTER (WHERE e.level = 'info')::int,
                   COUNT(*) FILTER (WHERE e.level = 'warn')::int,
                   COUNT(*) FILTER (WHERE e.level = 'error')::int,
                   COUNT(*) FILTER (WHERE e.level = 'fatal')::int,
                   MAX(e.timestamp)
            FROM events e
            WHERE e.project_id = ${projectId}::uuid
              AND e.timestamp >= ${toTs(boundary)}
              AND e.timestamp <  ${toTs(to)}
              AND e.template_hash IS NOT NULL
            GROUP BY 1
        ),
        merged AS (
            SELECT template_hash,
                   SUM(total)::int   AS total,
                   SUM(n_debug)::int AS n_debug,
                   SUM(n_info)::int  AS n_info,
                   SUM(n_warn)::int  AS n_warn,
                   SUM(n_error)::int AS n_error,
                   SUM(n_fatal)::int AS n_fatal,
                   MAX(latest)       AS latest
            FROM cells
            GROUP BY 1
            ORDER BY total DESC
            LIMIT ${limit}
        )
        -- One row per template now rather than one per (template, level), so
        -- the self-join the jsonb form needed is gone with it.
        SELECT
            COALESCE(mt.template, '(unknown template)') AS message,
            m.total::text                               AS count,
            m.latest                                    AS latest_at,
            m.n_debug, m.n_info, m.n_warn, m.n_error, m.n_fatal
        FROM merged m
        LEFT JOIN message_templates mt
               ON mt.project_id = ${projectId}::uuid
              AND mt.template_hash = m.template_hash
        -- The int column, never the text alias above it: ordering by the alias
        -- sorts "9" after "10". That defect shipped three times here already,
        -- recorded in logging.md.
        ORDER BY m.total DESC
    `);

    return rows.map((r) => ({
        message: r.message,
        count: Number(r.count),
        latestAt: new Date(r.latest_at),
        dominantLevel: pickDominantLevel(levelCounts(r)),
    }));
}

/**
 * Top N most frequent messages.
 *
 * **Two implementations, chosen by coverage.** Where the template rollup covers
 * the requested range, this groups by a `bigint` fingerprint over pre-aggregated
 * rows. Where it does not, it falls back to grouping `SUBSTRING(message, 1, 200)`
 * over raw events — the query that has always been here.
 *
 * The fallback is not a safety net that never fires. Events ingested before
 * `template_hash` shipped carry no fingerprint and never will, so every range
 * reaching back into that history takes the slow path, and will until 30-day
 * retention rolls those events out. Deleting the fallback the day the rollup
 * works would silently return a top-messages list missing everything older than
 * the deploy.
 *
 * Measured on staging, 8.9M events, a 7-day range: the raw form reads 4.5M rows
 * and hashes 1.13M groups in ~17 s; the rollup form reads ~899k rows and groups
 * ~18k. `PLAN.md` §16.3.
 */
export async function topMessages(
    projectId: string,
    range: TimeRange,
    limit = 10,
): Promise<TopMessage[]> {
    const { from, to } = resolveRange(range);

    const coverage = await templateCoverage(projectId);
    // `coverage.from === null` means every event carries a fingerprint, so
    // nothing sits below the rollup for the range to miss — whatever the range
    // is. Comparing against the *start of the window* instead is what sent
    // every 7d and 30d read to the fallback on a corpus younger than the
    // window, for a gap that contained no events at all.
    if (coverage && (coverage.from === null || from >= coverage.from)) {
        // Rollup below the ceiling, raw events above it. When the range ends
        // inside coverage there is no tail at all.
        const boundary = to < coverage.to ? to : coverage.to;
        return topMessagesFromRollup(projectId, from, to, boundary, limit);
    }

    return topMessagesFromEvents(projectId, from, to, limit);
}

/**
 * The original implementation, kept because it is the only one that can answer
 * for events with no fingerprint. See `topMessages` above for when it runs.
 */
async function topMessagesFromEvents(
    projectId: string,
    from: Date,
    to: Date,
    limit: number,
): Promise<TopMessage[]> {

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
 * The newest minute whose rollup row predates `by_source`, or `null` when
 * none do.
 *
 * Migration 0013 gave every existing row `'{}'`, which is distinguishable from
 * a real result because every event has a source or `(unknown)` — a rebuilt
 * row always carries at least one key. Reading those rows would silently drop
 * every source older than the migration from a 30-day chart, which on this
 * widget looks exactly like a service that stopped logging.
 *
 * They form a contiguous band ending at the migration, and the job refills it
 * oldest-first, so `MAX` is exact rather than conservative: any range starting
 * after this instant is fully served by the rollup. Short ranges therefore work
 * immediately after deploy and long ones heal as the rebuild advances, with no
 * window in which anything is wrong.
 *
 * A private helper rather than a sibling of `rollupBoundary` in
 * `shared/services/`: only this widget reads `by_source`, and PROJECT.md §2.1
 * puts code in `shared/` when a second feature needs it, not in anticipation.
 */
async function sourceRollupFloor(projectId: string): Promise<Date | null> {
    const [row] = await db.execute<{ newest: Date | null }>(sql`
        SELECT MAX(minute) AS newest
        FROM event_rollup_minutes
        WHERE project_id = ${projectId}::uuid
          AND by_source = '{}'::jsonb
    `);
    return row?.newest == null ? null : new Date(row.newest);
}

/** `topSources` served from the rollup, with raw events above the watermark. */
async function topSourcesFromRollup(
    projectId: string,
    from: Date,
    to: Date,
    boundary: Date,
    limit: number,
): Promise<SourceCount[]> {
    const rows = await db.execute<{ source: string; count: string }>(sql`
        WITH cells AS (
            SELECT s.key AS source, SUM(s.value::int)::int AS n
            FROM event_rollup_minutes r, jsonb_each_text(r.by_source) s
            WHERE r.project_id = ${projectId}::uuid
              AND r.minute >= ${toTs(from)}
              AND r.minute <  ${toTs(boundary)}
            GROUP BY 1

            UNION ALL

            -- The tail above the watermark, at most one minute of events.
            SELECT COALESCE(e.source, '(unknown)'), COUNT(*)::int
            FROM events e
            WHERE e.project_id = ${projectId}::uuid
              AND e.timestamp >= ${toTs(boundary)}
              AND e.timestamp <  ${toTs(to)}
            GROUP BY 1
        )
        SELECT source, SUM(n)::text AS count
        FROM cells
        GROUP BY source
        -- SUM(n), never the text alias: with a LIMIT a lexicographic sort drops
        -- the wrong ROWS, not merely reorders them. See the fallback below.
        ORDER BY SUM(n) DESC
        LIMIT ${limit}
    `);

    return rows.map((r) => ({ source: r.source, count: Number(r.count) }));
}

/** `topSources` grouped straight off raw `events`. */
async function topSourcesFromEvents(
    projectId: string,
    from: Date,
    to: Date,
    limit: number,
): Promise<SourceCount[]> {
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
 * Top N event sources (the `source` field) by event count.
 *
 * **Two implementations, chosen by coverage**, like `topMessages`. This was the
 * last read on either dashboard still scanning raw `events` across the whole
 * range, and the measurement that ended its deferral is in `PLAN.md` §17:
 * 856 ms and 29-41% of its time waiting on disk, against 0% for every
 * rollup-backed query on the page.
 *
 * The fallback stays for the same reason `topMessages` keeps its own: rows
 * written before migration 0013 carry no `by_source`, and reading them anyway
 * would drop every source older than the deploy without raising anything.
 */
export async function topSources(
    projectId: string,
    range: TimeRange,
    limit = 10,
): Promise<SourceCount[]> {
    const { from, to } = resolveRange(range);

    const [boundary, floor] = await Promise.all([
        rollupBoundary([projectId]),
        sourceRollupFloor(projectId),
    ]);

    if (boundary && (floor === null || from > floor)) {
        const clamped = boundary < to ? boundary : to;
        return topSourcesFromRollup(projectId, from, to, clamped, limit);
    }

    return topSourcesFromEvents(projectId, from, to, limit);
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
