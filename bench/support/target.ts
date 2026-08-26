import { sql } from "drizzle-orm";
import { db } from "@/core/db/client";
import { clickhouse } from "@/core/clickhouse/client";
import { EVENTS_TABLE } from "@/core/clickhouse/tables";

/**
 * Discovering what to benchmark, at run time.
 *
 * Project and organization identifiers differ between every database the
 * benchmark can be pointed at, so nothing here may be hardcoded. The target is
 * the organization holding the most events; the benchmark then reports what it
 * chose, because a number without the shape of the data behind it is not
 * comparable to anything.
 *
 * **Two stores since Phase 4.** Organizations and projects are Postgres rows;
 * the events are ClickHouse. So "the organization with the most events" is no
 * longer one join — it is a project list from one store and a count from the
 * other, matched in TypeScript. That is the shape of every cross-store question
 * this migration creates, and this harness is the least costly place to see it.
 */

export interface BenchTarget {
    organizationId: string;
    organizationName: string;
    projectIds: string[];
    /** Total events across those projects, all time. */
    totalEvents: number;
    /** Oldest and newest event timestamps, or null when there are none. */
    oldest: Date | null;
    newest: Date | null;
}

interface OrgRow {
    id: string;
    name: string;
    projectIds: string[];
}

/** Every live organization with its live projects, from Postgres. */
async function listOrganizations(): Promise<OrgRow[]> {
    const rows = await db.execute<{ id: string; name: string; project_id: string | null }>(sql`
        SELECT o.id::text, o.name, p.id::text AS project_id
        FROM organizations o
        LEFT JOIN projects p ON p.organization_id = o.id AND p.deleted_at IS NULL
        ORDER BY o.id, p.created_at
    `);

    const byOrg = new Map<string, OrgRow>();
    for (const row of rows) {
        const org = byOrg.get(row.id) ?? { id: row.id, name: row.name, projectIds: [] };
        if (row.project_id) org.projectIds.push(row.project_id);
        byOrg.set(row.id, org);
    }
    return [...byOrg.values()];
}

/** Events per project, all time, for the projects named. */
async function countByProject(projectIds: string[]): Promise<Map<string, number>> {
    if (projectIds.length === 0) return new Map();

    const result = await clickhouse.query({
        query: `SELECT toString(project_id) AS project_id, count() AS n
                FROM ${EVENTS_TABLE}
                WHERE project_id IN {ids:Array(UUID)}
                GROUP BY project_id`,
        query_params: { ids: projectIds },
        format: "JSONEachRow",
    });

    const rows = await result.json<{ project_id: string; n: string }>();
    return new Map(rows.map((row) => [row.project_id, Number(row.n)]));
}

export async function resolveBenchTarget(): Promise<BenchTarget> {
    const orgs = await listOrganizations();
    if (orgs.length === 0) {
        throw new Error(
            "no organizations in this database — seed a corpus first (npm run bench:seed) " +
                "or point DATABASE_URL at one that has data",
        );
    }

    const counts = await countByProject(orgs.flatMap((org) => org.projectIds));
    const totalFor = (org: OrgRow) =>
        org.projectIds.reduce((sum, id) => sum + (counts.get(id) ?? 0), 0);

    const org = orgs.reduce((best, next) => (totalFor(next) > totalFor(best) ? next : best));
    const span = await resolveSpan(org.projectIds);

    return {
        organizationId: org.id,
        organizationName: org.name,
        projectIds: org.projectIds,
        totalEvents: totalFor(org),
        oldest: span.oldest,
        newest: span.newest,
    };
}

/**
 * The corpus's first and last event.
 *
 * `min`/`max` over an empty set return the epoch rather than nothing (measured
 * — `lab/clickhouse/probe-aggregate-shapes.mjs`), so the count is what says
 * whether the answer means anything.
 */
async function resolveSpan(
    projectIds: string[],
): Promise<{ oldest: Date | null; newest: Date | null }> {
    if (projectIds.length === 0) return { oldest: null, newest: null };

    const result = await clickhouse.query({
        query: `SELECT count() AS n,
                       toUnixTimestamp64Milli(min(timestamp)) AS oldest_ms,
                       toUnixTimestamp64Milli(max(timestamp)) AS newest_ms
                FROM ${EVENTS_TABLE}
                WHERE project_id IN {ids:Array(UUID)}`,
        query_params: { ids: projectIds },
        format: "JSONEachRow",
    });

    const [row] = await result.json<{ n: string; oldest_ms: string; newest_ms: string }>();
    if (!row || Number(row.n) === 0) return { oldest: null, newest: null };

    return { oldest: new Date(Number(row.oldest_ms)), newest: new Date(Number(row.newest_ms)) };
}

/**
 * The range every benchmark uses: the last 24 hours of data *that exists*,
 * anchored on the newest event rather than on `now()`.
 *
 * Anchoring on the clock would silently measure an empty range against a
 * corpus that stopped being written to, and report it as a fast query.
 */
export function benchRange(target: BenchTarget): { from: Date; to: Date } {
    const to = target.newest ?? new Date();
    return { from: new Date(to.getTime() - 24 * 60 * 60_000), to: new Date(to.getTime() + 1) };
}

/** One environment and what share of the range it accounts for. */
export interface BenchEnvironment {
    name: string;
    /** Events carrying it, within `range`. */
    events: number;
    /** Its share of the range, 0–1. */
    share: number;
}

/**
 * The environment the filtered benchmarks select, discovered at run time.
 *
 * Hardcoding "production" would measure nothing on a corpus that does not use
 * the name, and the harness already refuses to hardcode identifiers for the
 * same reason. The **busiest** one is chosen deliberately: an environment
 * filter narrows a scan by excluding rows, so the busiest value is the one the
 * filter helps least, and a benchmark that picked the quietest would report the
 * most flattering number available rather than the one a user is most likely to
 * hit.
 *
 * `share` is reported because it is what makes the number transferable. A
 * filtered scan's cost tracks the rows it must *read*, not the rows it returns,
 * so the same query on a 50/50 corpus and on a 90/10 one says different things
 * about whether an index would have helped. Without the share printed beside
 * it, the timing cannot be compared to another machine's.
 *
 * Returns `null` when the corpus has no environments at all — the filtered
 * benchmarks then have nothing to measure and say so, instead of silently
 * benchmarking an empty result.
 */
export async function resolveBenchEnvironment(
    target: BenchTarget,
    range: { from: Date; to: Date },
): Promise<BenchEnvironment | null> {
    if (target.projectIds.length === 0) return null;

    const rows = await eventsByColumn(target.projectIds, range, "environment");
    if (rows.length === 0) return null;

    const total = rows.reduce((sum, row) => sum + row.n, 0);
    const busiest = rows[0];
    return {
        name: busiest.value,
        events: busiest.n,
        share: total > 0 ? busiest.n / total : 0,
    };
}

/**
 * Counts per value of one column over the range, busiest first, blanks
 * excluded.
 *
 * The column name is interpolated and every value is bound. It is a literal
 * passed by this module — the harness has two callers and both spell the
 * column out — never anything from a request; a bound identifier is not a thing
 * ClickHouse offers.
 */
async function eventsByColumn(
    projectIds: string[],
    range: { from: Date; to: Date },
    column: "environment" | "project_id",
): Promise<Array<{ value: string; n: number }>> {
    const result = await clickhouse.query({
        query: `SELECT toString(${column}) AS value, count() AS n
                FROM ${EVENTS_TABLE}
                WHERE project_id IN {ids:Array(UUID)}
                  AND timestamp >= {from:DateTime64(3, 'UTC')}
                  AND timestamp <  {to:DateTime64(3, 'UTC')}
                  AND ${column} != ''
                GROUP BY value
                ORDER BY n DESC, value ASC`,
        query_params: { ids: projectIds, from: range.from, to: range.to },
        format: "JSONEachRow",
    });

    const rows = await result.json<{ value: string; n: string }>();
    return rows.map((row) => ({ value: row.value, n: Number(row.n) }));
}

/**
 * The project the per-project benchmarks run against: the busiest one in the
 * range.
 *
 * Same reasoning as the environment above — the busiest project is the one a
 * dashboard is slowest on, and a harness that picked the quietest would report
 * the most flattering number in the corpus.
 */
export async function resolveBusiestProject(
    target: BenchTarget,
    range: { from: Date; to: Date },
): Promise<string | null> {
    if (target.projectIds.length === 0) return null;
    const rows = await eventsByColumn(target.projectIds, range, "project_id");
    return rows[0]?.value ?? null;
}

export function describeTarget(target: BenchTarget, range: { from: Date; to: Date }): string {
    const days =
        target.oldest && target.newest
            ? ((target.newest.getTime() - target.oldest.getTime()) / 86_400_000).toFixed(1)
            : "?";
    return [
        `org "${target.organizationName}" · ${target.projectIds.length} projects`,
        `${target.totalEvents.toLocaleString()} events spanning ${days} days`,
        `range ${range.from.toISOString()} → ${range.to.toISOString()}`,
    ].join("\n  ");
}
