import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/core/db/client";
import { projects } from "@/core/db/schema";
import type { Event } from "@/shared/types/event.types";
import { clickhouse } from "@/core/clickhouse/client";
import { EVENTS_TABLE } from "@/core/clickhouse/tables";
import { compileFilters, type FacetField } from "@/core/clickhouse/filter-compiler";
import type { ClickhouseEventReadRow } from "@/core/clickhouse/event-row.types";
import { resolveRange } from "@/shared/utils/dashboard-filters";
import { fromClickhouseRow } from "@/core/clickhouse/from-event-row";
import type { EventFilters, Cursor, FacetCounts, FacetOption } from "@/features/events/utils/event-filters.types";

/**
 * The events read path, on ClickHouse since Phase 3 of
 * `docs/features/09-clickhouse.md`.
 *
 * Three things moved and one did not.
 *
 * **The `WHERE` clause left this file.** `buildConditions` was a private
 * function here and a near-copy of it lived in `alert-evaluator.service.ts`;
 * both are now `core/clickhouse/filter-compiler.ts`. Two implementations of one
 * filter is precisely how `topMessages` came to have two answers.
 *
 * **The time-range arithmetic left too.** `resolveTimeRange` here and
 * `resolveRange` in `shared/utils/dashboard-filters.ts` were the same six
 * offsets written twice, which is the duplication that module was created to
 * end (2026-08-25). This one was simply missed.
 *
 * **The `projects` join could not come along.** ClickHouse cannot join a
 * Postgres table, and the join was defence in depth: both callers already
 * resolve the project through `getProjectBySlug`, which filters
 * `deleted_at IS NULL`. Dropping the property silently was not an option, so it
 * is a separate lookup that runs *concurrently* with the ClickHouse query —
 * a primary-key hit against a table the same request has already read, and it
 * adds no latency to a page that is waiting on the larger query anyway.
 */

const PAGE_SIZE = 50;
const FACET_OPTION_LIMIT = 20;

/** Facet counts render blank as this, exactly as the Postgres version did. */
const UNSET_LABEL = "(unset)";

export type EventsPage = {
    events: Event[];
    hasMore: boolean;
};

/**
 * Three columns need converting before they leave the server; the rest are read
 * as stored. `ClickhouseEventReadRow` documents why each one does.
 */
const READ_COLUMNS = `
    id,
    project_id,
    toUnixTimestamp64Milli(timestamp) AS ts_ms,
    toString(level) AS level,
    message,
    source, environment, release, error_type,
    user_id, session_id, request_id, trace_id,
    stack_trace, attributes, context, user_agent,
    toString(ip) AS ip,
    toString(reinterpretAsInt64(template_hash)) AS template_hash
`;

/**
 * Integers in the `JSON` column come back quoted by default — a stored `2`
 * reads as `"2"` — which would put a string in the attributes panel where
 * Postgres put a number.
 *
 * It is safe *here* only because every 64-bit value that must survive exactly
 * is already a string by then: `template_hash` is converted in the `SELECT`
 * above for this reason. Turning it off globally would round the fingerprint to
 * 18446744073709552000, which is why it is set per query rather than on the
 * client.
 */
const READ_SETTINGS = { output_format_json_quote_64bit_integers: 0 } as const;

/**
 * Is the project still there? The half of the old `innerJoin` that survives the
 * move to a second store.
 */
async function isProjectLive(projectId: string): Promise<boolean> {
    const rows = await db
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
        .limit(1);

    return rows.length > 0;
}

/**
 * List events with filters and cursor-based pagination.
 * Returns up to 50 events + hasMore flag.
 */
export async function listEvents(
    projectId: string,
    filters: EventFilters,
    cursor?: Cursor,
): Promise<EventsPage> {
    const { from, to } = resolveRange(filters.range);
    const { where, params } = compileFilters(projectId, filters, { from, to });

    const clauses = [where];
    const queryParams: Record<string, unknown> = { ...params };

    if (cursor) {
        // The sort key is (project_id, timestamp, id), so a tuple comparison is
        // the keyset predicate — and the names are outside the compiler's
        // `p0…pN` space by contract, not by luck.
        clauses.push(
            "(timestamp, id) < ({cursor_ts:DateTime64(3, 'UTC')}, {cursor_id:UUID})",
        );
        queryParams.cursor_ts = new Date(cursor.beforeTs);
        queryParams.cursor_id = cursor.beforeId;
    }

    const [live, rows] = await Promise.all([
        isProjectLive(projectId),
        selectEvents(clauses.join(" AND "), queryParams, PAGE_SIZE + 1),
    ]);

    if (!live) return { events: [], hasMore: false };

    return {
        events: rows.slice(0, PAGE_SIZE).map(fromClickhouseRow),
        hasMore: rows.length > PAGE_SIZE,
    };
}

async function selectEvents(
    where: string,
    params: Record<string, unknown>,
    limit: number,
): Promise<ClickhouseEventReadRow[]> {
    const result = await clickhouse.query({
        query: `
            SELECT ${READ_COLUMNS}
            FROM ${EVENTS_TABLE}
            WHERE ${where}
            ORDER BY timestamp DESC, id DESC
            LIMIT ${limit}
        `,
        query_params: params,
        format: "JSONEachRow",
        clickhouse_settings: READ_SETTINGS,
    });

    return result.json<ClickhouseEventReadRow>();
}

/**
 * Get a single event by (projectId, id, ts).
 *
 * `ts` is still required, and for the same reason as under Postgres: it is the
 * second column of the sort key, so supplying it turns a scan of the project's
 * whole history into a granule lookup. The drawer's URL carries it.
 */
export async function getEventById(
    projectId: string,
    id: string,
    ts: Date,
): Promise<Event | null> {
    const [live, rows] = await Promise.all([
        isProjectLive(projectId),
        selectEvents(
            "project_id = {project:UUID} AND id = {id:UUID} AND timestamp = {ts:DateTime64(3, 'UTC')}",
            { project: projectId, id, ts },
            1,
        ),
    ]);

    if (!live || rows.length === 0) return null;
    return fromClickhouseRow(rows[0]);
}

async function facetRows(query: string, params: Record<string, unknown>): Promise<FacetOption[]> {
    const result = await clickhouse.query({ query, query_params: params, format: "JSONEachRow" });

    // `count()` is a UInt64 and arrives as a string; `FacetOption.count` is a
    // number, and a facet count that overflows one has other problems.
    return (await result.json<{ value: string; count: string }>()).map((row) => ({
        value: row.value,
        count: Number(row.count),
    }));
}

/**
 * Count distinct values of one column, scoped by the given clause.
 *
 * Blank is folded to `(unset)` where Postgres folded `NULL` — the column is
 * `LowCardinality(String)` and the schema has no `Nullable` anywhere (§4.1).
 *
 * The `value` tiebreak is new. Postgres ordered by count alone, so which
 * options survived `LIMIT 20` among equal counts was whatever the plan happened
 * to produce — a panel that could reshuffle between two identical loads. This
 * repository has already been bitten three times by an `ORDER BY` that looked
 * deterministic and was not.
 */
function textFacet(
    column: string,
    where: string,
    params: Record<string, unknown>,
): Promise<FacetOption[]> {
    return facetRows(
        `
            SELECT if(${column} = '', '${UNSET_LABEL}', ${column}) AS value,
                   count() AS count
            FROM ${EVENTS_TABLE}
            WHERE ${where}
            GROUP BY value
            ORDER BY count DESC, value ASC
            LIMIT ${FACET_OPTION_LIMIT}
        `,
        params,
    );
}

/**
 * The level facet takes no `LIMIT`: there are five levels and the panel shows
 * all of them, which is what the Postgres version did too.
 */
function levelFacet(where: string, params: Record<string, unknown>): Promise<FacetOption[]> {
    return facetRows(
        `
            SELECT toString(level) AS value, count() AS count
            FROM ${EVENTS_TABLE}
            WHERE ${where}
            GROUP BY level
            ORDER BY count DESC, value ASC
        `,
        params,
    );
}

/**
 * Facet option counts for level/environment/source/release/errorType, each
 * scoped by project + time range and every *other* active filter — but not the
 * facet's own filter, so unchecking an option elsewhere never zeroes out its
 * own count list.
 */
export async function getFacetCounts(projectId: string, filters: EventFilters): Promise<FacetCounts> {
    const { from, to } = resolveRange(filters.range);

    const scoped = (exclude: FacetField) =>
        compileFilters(projectId, filters, { from, to, exclude: [exclude] });

    const levels = scoped("levels");
    const environments = scoped("environments");
    const sources = scoped("sources");
    const releases = scoped("releases");
    const errorTypes = scoped("errorTypes");

    const [live, level, environment, source, release, errorType] = await Promise.all([
        isProjectLive(projectId),
        levelFacet(levels.where, levels.params),
        textFacet("environment", environments.where, environments.params),
        textFacet("source", sources.where, sources.params),
        textFacet("release", releases.where, releases.params),
        textFacet("error_type", errorTypes.where, errorTypes.params),
    ]);

    if (!live) return { levels: [], environments: [], sources: [], releases: [], errorTypes: [] };

    return {
        levels: level,
        environments: environment,
        sources: source,
        releases: release,
        errorTypes: errorType,
    };
}
