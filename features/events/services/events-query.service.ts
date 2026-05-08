import {
    and,
    desc,
    eq,
    gte,
    isNull,
    lte,
    lt,
    or,
    sql,
    inArray,
} from "drizzle-orm";
import { db } from "@/core/db/client";
import { events } from "@/core/db/schema";
import { projects } from "@/core/db/schema";
import type { EventFilters, Cursor } from "@/features/events/utils/event-filters.types";
import type { Event } from "@/core/db/schema";

const PAGE_SIZE = 50;

export type EventsPage = {
    events: Event[];
    hasMore: boolean;
};

/**
 * Resolve a TimeRange to UTC Date boundaries.
 */
function resolveTimeRange(filters: EventFilters): { from: Date; to: Date } {
    const now = new Date();

    if (filters.range.type === "custom") {
        return {
            from: new Date(filters.range.from),
            to: new Date(filters.range.to),
        };
    }

    const OFFSETS: Record<string, number> = {
        "15m": 15 * 60 * 1000,
        "1h": 60 * 60 * 1000,
        "6h": 6 * 60 * 60 * 1000,
        "24h": 24 * 60 * 60 * 1000,
        "7d": 7 * 24 * 60 * 60 * 1000,
        "30d": 30 * 24 * 60 * 60 * 1000,
    };

    return {
        from: new Date(now.getTime() - (OFFSETS[filters.range.value] ?? OFFSETS["1h"])),
        to: now,
    };
}

/**
 * List events with filters and cursor-based pagination.
 * Returns up to 50 events + hasMore flag.
 * Defense-in-depth: JOINs projects and filters deleted_at IS NULL.
 */
export async function listEvents(
    projectId: string,
    filters: EventFilters,
    cursor?: Cursor,
): Promise<EventsPage> {
    const { from, to } = resolveTimeRange(filters);

    const conditions = [
        eq(events.projectId, projectId),
        isNull(projects.deletedAt),
        gte(events.timestamp, from),
        lte(events.timestamp, to),
    ];

    if (filters.levels?.length) {
        conditions.push(inArray(events.level, filters.levels));
    }

    if (filters.environments?.length) {
        conditions.push(inArray(events.environment, filters.environments as [string, ...string[]]));
    }

    if (filters.sources?.length) {
        conditions.push(inArray(events.source, filters.sources as [string, ...string[]]));
    }

    if (filters.releases?.length) {
        conditions.push(inArray(events.release, filters.releases as [string, ...string[]]));
    }

    if (filters.errorTypes?.length) {
        conditions.push(inArray(events.errorType, filters.errorTypes as [string, ...string[]]));
    }

    if (filters.userId) {
        conditions.push(eq(events.userId, filters.userId));
    }

    if (filters.sessionId) {
        conditions.push(eq(events.sessionId, filters.sessionId));
    }

    if (filters.requestId) {
        conditions.push(eq(events.requestId, filters.requestId));
    }

    if (filters.traceId) {
        conditions.push(eq(events.traceId, filters.traceId));
    }

    if (filters.message) {
        const tsquery = sql`to_tsvector('simple', ${events.message}) @@ websearch_to_tsquery('simple', ${filters.message})`;
        conditions.push(tsquery);
    }

    if (filters.attributes?.length) {
        for (const { key, value } of filters.attributes) {
            const jsonFragment = JSON.stringify({ [key]: value });
            conditions.push(sql`${events.attributes} @> ${jsonFragment}::jsonb`);
        }
    }

    // Cursor: rows strictly before (timestamp, id) DESC
    if (cursor) {
        const cursorTs = new Date(cursor.beforeTs);
        conditions.push(
            or(
                lt(events.timestamp, cursorTs),
                and(
                    eq(events.timestamp, cursorTs),
                    lt(events.id, cursor.beforeId),
                ),
            )!,
        );
    }

    const rows = await db
        .select({ events })
        .from(events)
        .innerJoin(projects, eq(events.projectId, projects.id))
        .where(and(...conditions))
        .orderBy(desc(events.timestamp), desc(events.id))
        .limit(PAGE_SIZE + 1);

    const hasMore = rows.length > PAGE_SIZE;
    const sliced = rows.slice(0, PAGE_SIZE).map((r) => r.events);

    return { events: sliced, hasMore };
}

/**
 * Get a single event by (projectId, id, ts).
 * Requires ts for partition pruning.
 */
export async function getEventById(
    projectId: string,
    id: string,
    ts: Date,
): Promise<Event | null> {
    const rows = await db
        .select({ events })
        .from(events)
        .innerJoin(projects, eq(events.projectId, projects.id))
        .where(
            and(
                eq(events.projectId, projectId),
                eq(events.id, id),
                eq(events.timestamp, ts),
                isNull(projects.deletedAt),
            ),
        )
        .limit(1);

    return rows[0]?.events ?? null;
}
