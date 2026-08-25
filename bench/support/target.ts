import { sql } from "drizzle-orm";
import { db } from "@/core/db/client";

/**
 * Discovering what to benchmark, at run time.
 *
 * Project and organization identifiers differ between every database the
 * benchmark can be pointed at, so nothing here may be hardcoded. The target is
 * the organization holding the most events; the benchmark then reports what it
 * chose, because a number without the shape of the data behind it is not
 * comparable to anything.
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

export async function resolveBenchTarget(): Promise<BenchTarget> {
    const orgs = await db.execute<{ id: string; name: string; total: string }>(sql`
        SELECT o.id::text, o.name, COUNT(e.project_id)::text AS total
        FROM organizations o
        JOIN projects p ON p.organization_id = o.id AND p.deleted_at IS NULL
        LEFT JOIN events e ON e.project_id = p.id
        GROUP BY o.id, o.name
        ORDER BY COUNT(e.project_id) DESC
        LIMIT 1
    `);

    if (orgs.length === 0) {
        throw new Error(
            "no organizations in this database — seed a corpus first (npm run bench:seed) " +
                "or point DATABASE_URL at one that has data",
        );
    }

    const org = orgs[0];

    const projects = await db.execute<{ id: string }>(sql`
        SELECT id::text FROM projects
        WHERE organization_id = ${org.id}::uuid AND deleted_at IS NULL
        ORDER BY created_at
    `);

    const span = await db.execute<{ oldest: Date | null; newest: Date | null }>(sql`
        SELECT MIN(timestamp) AS oldest, MAX(timestamp) AS newest
        FROM events
        WHERE project_id = ANY(ARRAY[${sql.join(
            projects.map((p) => sql`${p.id}::uuid`),
            sql`, `,
        )}])
    `);

    return {
        organizationId: org.id,
        organizationName: org.name,
        projectIds: projects.map((p) => p.id),
        totalEvents: Number(org.total),
        oldest: span[0]?.oldest ? new Date(span[0].oldest) : null,
        newest: span[0]?.newest ? new Date(span[0].newest) : null,
    };
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

    const ids = sql.join(
        target.projectIds.map((id) => sql`${id}::uuid`),
        sql`, `,
    );

    const rows = await db.execute<{ environment: string | null; n: string; total: string }>(sql`
        SELECT environment,
               COUNT(*)::text                     AS n,
               SUM(COUNT(*)) OVER ()::text        AS total
        FROM events
        WHERE project_id = ANY(ARRAY[${ids}])
          AND timestamp >= ${range.from.toISOString()}::timestamptz
          AND timestamp <  ${range.to.toISOString()}::timestamptz
          AND environment IS NOT NULL
        GROUP BY environment
        ORDER BY COUNT(*) DESC
        LIMIT 1
    `);

    if (rows.length === 0 || rows[0].environment === null) return null;

    const events = Number(rows[0].n);
    const total = Number(rows[0].total);
    return {
        name: rows[0].environment,
        events,
        share: total > 0 ? events / total : 0,
    };
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
