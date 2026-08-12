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
    type SQL,
} from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { db } from "@/core/db/client";
import { events } from "@/core/db/schema";
import { projects } from "@/core/db/schema";
import type { EventFilters, Cursor, FacetCounts } from "@/features/events/utils/event-filters.types";
import type { Event } from "@/core/db/schema";

const PAGE_SIZE = 50;
const FACET_OPTION_LIMIT = 20;

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
 * Build the shared WHERE conditions for events queries (project scope, time range,
 * and one clause per active filter field). `exclude` skips a field's own clause —
 * used by facet-count queries so a field's own selection doesn't shrink its own counts.
 */
function buildConditions(
    projectId: string,
    filters: EventFilters,
    exclude: (keyof EventFilters)[] = [],
): SQL[] {
    const { from, to } = resolveTimeRange(filters);

    const conditions: SQL[] = [
        eq(events.projectId, projectId),
        isNull(projects.deletedAt),
        gte(events.timestamp, from),
        lte(events.timestamp, to),
    ];

    if (!exclude.includes("levels") && filters.levels?.length) {
        conditions.push(inArray(events.level, filters.levels));
    }

    if (!exclude.includes("environments") && filters.environments?.length) {
        conditions.push(inArray(events.environment, filters.environments as [string, ...string[]]));
    }

    if (!exclude.includes("sources") && filters.sources?.length) {
        conditions.push(inArray(events.source, filters.sources as [string, ...string[]]));
    }

    if (!exclude.includes("releases") && filters.releases?.length) {
        conditions.push(inArray(events.release, filters.releases as [string, ...string[]]));
    }

    if (!exclude.includes("errorTypes") && filters.errorTypes?.length) {
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
        conditions.push(
            sql`to_tsvector('simple', ${events.message}) @@ websearch_to_tsquery('simple', ${filters.message})`,
        );
    }

    if (filters.attributes?.length) {
        for (const { key, value } of filters.attributes) {
            const jsonFragment = JSON.stringify({ [key]: value });
            conditions.push(sql`${events.attributes} @> ${jsonFragment}::jsonb`);
        }
    }

    return conditions;
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
    const conditions = buildConditions(projectId, filters);

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

/**
 * Count distinct values of a nullable text column, scoped by the given conditions.
 * Null values are grouped under "(unset)".
 */
function textFacet(column: AnyPgColumn, conditions: SQL[]) {
    return db
        .select({
            value: sql<string>`coalesce(${column}, '(unset)')`,
            count: sql<number>`count(*)::int`,
        })
        .from(events)
        .innerJoin(projects, eq(events.projectId, projects.id))
        .where(and(...conditions))
        .groupBy(sql`coalesce(${column}, '(unset)')`)
        .orderBy(desc(sql`count(*)`))
        .limit(FACET_OPTION_LIMIT);
}

/**
 * Facet option counts for level/environment/source/release/errorType, each scoped by
 * project + time range and every *other* active filter — but not the facet's own
 * filter, so unchecking an option elsewhere never zeroes out its own count list.
 */
export async function getFacetCounts(projectId: string, filters: EventFilters): Promise<FacetCounts> {
    const [levels, environments, sources, releases, errorTypes] = await Promise.all([
        db
            .select({ value: events.level, count: sql<number>`count(*)::int` })
            .from(events)
            .innerJoin(projects, eq(events.projectId, projects.id))
            .where(and(...buildConditions(projectId, filters, ["levels"])))
            .groupBy(events.level)
            .orderBy(desc(sql`count(*)`)),
        textFacet(events.environment, buildConditions(projectId, filters, ["environments"])),
        textFacet(events.source, buildConditions(projectId, filters, ["sources"])),
        textFacet(events.release, buildConditions(projectId, filters, ["releases"])),
        textFacet(events.errorType, buildConditions(projectId, filters, ["errorTypes"])),
    ]);

    return { levels, environments, sources, releases, errorTypes };
}
