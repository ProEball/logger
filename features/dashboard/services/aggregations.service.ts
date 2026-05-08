import { sql } from "drizzle-orm";
import { db } from "@/core/db/client";
import type { TimeRange } from "@/features/events/utils/event-filters.types";
import type { Event } from "@/core/db/schema";
import { resolveRange, pickBucket, BUCKET_SECONDS } from "@/features/dashboard/utils/aggregation-utils";

// Re-export pure helpers so callers can import from one place.
export { resolveRange, pickBucket } from "@/features/dashboard/utils/aggregation-utils";
export type { BucketSize } from "@/features/dashboard/utils/aggregation-utils";

// ─── Result types ─────────────────────────────────────────────────────────────

export type BucketRow = {
    ts: Date;
    total: number;
    byLevel: Record<string, number>;
};

export type LevelCount = {
    level: string;
    count: number;
};

export type EnvCount = {
    environment: string;
    count: number;
};

export type TopMessage = {
    message: string;
    count: number;
    latestAt: Date;
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
export async function eventsPerMinute(
    projectId: string,
    range: TimeRange,
): Promise<BucketRow[]> {
    const { from, to } = resolveRange(range);
    const bucketSize = pickBucket(from, to);

    // date_trunc only accepts unit names like 'minute'/'hour', not '5m'/'4h'.
    // Use epoch-floor arithmetic instead: works for any bucket width in seconds.
    // BUCKET_SECONDS is a controlled constant — safe to inline as raw SQL integer.
    const secs = BUCKET_SECONDS[bucketSize];
    const rows = await db.execute<{ ts: Date; level: string; cnt: string }>(sql`
        SELECT
            to_timestamp(floor(extract(epoch from timestamp) / ${sql.raw(String(secs))}) * ${sql.raw(String(secs))}) AS ts,
            level,
            COUNT(*)::text AS cnt
        FROM events
        WHERE project_id = ${projectId}
          AND timestamp >= ${toTs(from)}
          AND timestamp <  ${toTs(to)}
        GROUP BY 1, 2
        ORDER BY 1 ASC
    `);

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

    return Array.from(bucketMap.values());
}

/**
 * Count of events grouped by level for the given range.
 */
export async function levelBreakdown(
    projectId: string,
    range: TimeRange,
): Promise<LevelCount[]> {
    const { from, to } = resolveRange(range);

    const rows = await db.execute<{ level: string; count: string }>(sql`
        SELECT level, COUNT(*)::text AS count
        FROM events
        WHERE project_id = ${projectId}
          AND timestamp >= ${toTs(from)}
          AND timestamp <  ${toTs(to)}
        GROUP BY level
        ORDER BY count DESC
    `);

    return rows.map((r) => ({ level: r.level, count: Number(r.count) }));
}

/**
 * Count of events grouped by environment for the given range.
 * NULL environment is labelled "(unset)".
 */
export async function environmentBreakdown(
    projectId: string,
    range: TimeRange,
): Promise<EnvCount[]> {
    const { from, to } = resolveRange(range);

    const rows = await db.execute<{ environment: string; count: string }>(sql`
        SELECT COALESCE(environment, '(unset)') AS environment, COUNT(*)::text AS count
        FROM events
        WHERE project_id = ${projectId}
          AND timestamp >= ${toTs(from)}
          AND timestamp <  ${toTs(to)}
        GROUP BY 1
        ORDER BY count DESC
    `);

    return rows.map((r) => ({ environment: r.environment, count: Number(r.count) }));
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

    const rows = await db.execute<{ message: string; count: string; latest_at: Date }>(sql`
        SELECT
            SUBSTRING(message, 1, 200) AS message,
            COUNT(*)::text             AS count,
            MAX(timestamp)             AS latest_at
        FROM events
        WHERE project_id = ${projectId}
          AND timestamp >= ${toTs(from)}
          AND timestamp <  ${toTs(to)}
        GROUP BY SUBSTRING(message, 1, 200)
        ORDER BY count DESC
        LIMIT ${limit}
    `);

    return rows.map((r) => ({
        message: r.message,
        count: Number(r.count),
        latestAt: new Date(r.latest_at),
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
 * True if the project has at least one event ever (across all partitions).
 * Used to decide whether to show the empty-project onboarding CTA.
 */
export async function hasAnyEvents(projectId: string): Promise<boolean> {
    const [row] = await db.execute<{ has_events: boolean }>(sql`
        SELECT EXISTS (
            SELECT 1 FROM events WHERE project_id = ${projectId} LIMIT 1
        ) AS has_events
    `);
    return row?.has_events ?? false;
}
