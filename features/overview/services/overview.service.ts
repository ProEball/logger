import { sql } from "drizzle-orm";
import { db } from "@/core/db/client";

export type DateRange = { from: Date; to: Date };

export type ProjectEventSummary = {
    projectId: string;
    totalEvents: number;
    errorCount: number;
    environments: string[];
    topMessage: string | null;
    topMessageLevel: string | null;
};

export type ProjectRow = {
    project: { id: string; slug: string; name: string };
    totalEvents: number;
    errorCount: number;
    environments: string[];
    topMessage: string | null;
    topMessageLevel: string | null;
    firingAlertsCount: number;
    enabledAlertsCount: number;
};

export type OrgLevelCount = {
    level: string;
    count: number;
};

export type OrgTopError = {
    message: string;
    count: number;
    projectId: string;
    dominantLevel: string;
    latestAt: Date;
};

export type OrgEventBucket = {
    projectId: string;
    ts: Date;
    count: number;
    errorCount: number;
};

function toTs(d: Date) {
    return sql`${d.toISOString()}::timestamptz`;
}

function uuidArray(ids: string[]) {
    return sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);
}

function levelCond(levels?: string[]) {
    if (!levels || levels.length === 0) return sql``;
    return sql` AND level = ANY(ARRAY[${sql.join(levels.map((l) => sql`${l}`), sql`, `)}])`;
}

function envCond(environments?: string[]) {
    if (!environments || environments.length === 0) return sql``;
    return sql` AND environment = ANY(ARRAY[${sql.join(environments.map((e) => sql`${e}`), sql`, `)}])`;
}

export async function getProjectSummaries(
    projectIds: string[],
    range: DateRange,
    levels?: string[],
    environments?: string[],
): Promise<Map<string, ProjectEventSummary>> {
    if (projectIds.length === 0) return new Map();
    const { from, to } = range;

    const [statsRows, topMsgRows, envRows] = await Promise.all([
        db.execute<{ project_id: string; total: string; error_count: string }>(sql`
            SELECT
                project_id::text,
                COUNT(*)::text                                        AS total,
                COUNT(*) FILTER (WHERE level IN ('error', 'fatal'))::text AS error_count
            FROM events
            WHERE project_id = ANY(ARRAY[${uuidArray(projectIds)}])
              AND timestamp >= ${toTs(from)}
              AND timestamp <  ${toTs(to)}
              ${levelCond(levels)}
              ${envCond(environments)}
            GROUP BY project_id
        `),
        db.execute<{ project_id: string; message: string; dominant_level: string }>(sql`
            WITH ranked AS (
                SELECT
                    project_id::text,
                    SUBSTRING(message, 1, 120)                          AS message,
                    mode() WITHIN GROUP (ORDER BY level)                AS dominant_level,
                    ROW_NUMBER() OVER (
                        PARTITION BY project_id
                        ORDER BY COUNT(*) DESC
                    )                                                   AS rn
                FROM events
                WHERE project_id = ANY(ARRAY[${uuidArray(projectIds)}])
                  AND timestamp >= ${toTs(from)}
                  AND timestamp <  ${toTs(to)}
                  AND level IN ('error', 'fatal')
                  ${envCond(environments)}
                GROUP BY project_id, SUBSTRING(message, 1, 120)
            )
            SELECT project_id, message, dominant_level
            FROM   ranked
            WHERE  rn = 1
        `),
        db.execute<{ project_id: string; envs: string | null }>(sql`
            SELECT
                project_id::text,
                STRING_AGG(DISTINCT environment, ',') AS envs
            FROM events
            WHERE project_id = ANY(ARRAY[${uuidArray(projectIds)}])
              AND timestamp >= ${toTs(from)}
              AND timestamp <  ${toTs(to)}
              AND environment IS NOT NULL
            GROUP BY project_id
        `),
    ]);

    const envMap = new Map<string, string[]>();
    for (const row of envRows) {
        envMap.set(row.project_id, row.envs ? row.envs.split(",").sort() : []);
    }

    const map = new Map<string, ProjectEventSummary>();
    for (const row of statsRows) {
        map.set(row.project_id, {
            projectId: row.project_id,
            totalEvents: Number(row.total),
            errorCount: Number(row.error_count),
            environments: envMap.get(row.project_id) ?? [],
            topMessage: null,
            topMessageLevel: null,
        });
    }
    for (const row of topMsgRows) {
        const entry = map.get(row.project_id);
        if (entry) {
            entry.topMessage = row.message;
            entry.topMessageLevel = row.dominant_level;
        }
    }
    return map;
}

export async function getOrgLevelBreakdown(
    projectIds: string[],
    range: DateRange,
    environments?: string[],
): Promise<OrgLevelCount[]> {
    if (projectIds.length === 0) return [];
    const { from, to } = range;

    const rows = await db.execute<{ level: string; count: string }>(sql`
        SELECT level, COUNT(*)::text AS count
        FROM events
        WHERE project_id = ANY(ARRAY[${uuidArray(projectIds)}])
          AND timestamp >= ${toTs(from)}
          AND timestamp <  ${toTs(to)}
          ${envCond(environments)}
        GROUP BY level
        ORDER BY count DESC
    `);
    return rows.map((r) => ({ level: r.level, count: Number(r.count) }));
}

export async function getOrgTopErrors(
    projectIds: string[],
    range: DateRange,
    levels?: string[],
    environments?: string[],
    limit = 5,
): Promise<OrgTopError[]> {
    if (projectIds.length === 0) return [];
    const { from, to } = range;

    const lc = levels && levels.length > 0
        ? sql` AND level = ANY(ARRAY[${sql.join(levels.map((l) => sql`${l}`), sql`, `)}])`
        : sql` AND level IN ('error', 'fatal')`;

    const rows = await db.execute<{
        message: string;
        count: string;
        project_id: string;
        dominant_level: string;
        latest_at: Date;
    }>(sql`
        SELECT
            SUBSTRING(message, 1, 200)                                AS message,
            COUNT(*)::text                                            AS count,
            mode() WITHIN GROUP (ORDER BY project_id::text)          AS project_id,
            mode() WITHIN GROUP (ORDER BY level)                      AS dominant_level,
            MAX(timestamp)                                            AS latest_at
        FROM events
        WHERE project_id = ANY(ARRAY[${uuidArray(projectIds)}])
          AND timestamp >= ${toTs(from)}
          AND timestamp <  ${toTs(to)}
          ${lc}
          ${envCond(environments)}
        GROUP BY SUBSTRING(message, 1, 200)
        ORDER BY count DESC
        LIMIT ${limit}
    `);

    return rows.map((r) => ({
        message: r.message,
        count: Number(r.count),
        projectId: r.project_id,
        dominantLevel: r.dominant_level,
        latestAt: new Date(r.latest_at),
    }));
}

export async function getOrgEnvironments(projectIds: string[]): Promise<string[]> {
    if (projectIds.length === 0) return [];

    const rows = await db.execute<{ environment: string }>(sql`
        SELECT DISTINCT COALESCE(environment, '(unset)') AS environment
        FROM events
        WHERE project_id = ANY(ARRAY[${uuidArray(projectIds)}])
          AND timestamp >= NOW() - INTERVAL '30 days'
        ORDER BY environment
    `);
    return rows.map((r) => r.environment);
}

export async function getOrgEventBuckets(
    projectIds: string[],
    range: DateRange,
    bucketSecs = 3600,
): Promise<OrgEventBucket[]> {
    if (projectIds.length === 0) return [];
    const { from, to } = range;

    const rows = await db.execute<{ project_id: string; ts: string; count: string; error_count: string }>(sql`
        SELECT
            project_id::text,
            to_timestamp(
                floor(extract(epoch from timestamp) / ${bucketSecs}) * ${bucketSecs}
            )::timestamptz AS ts,
            COUNT(*)::text                                            AS count,
            COUNT(*) FILTER (WHERE level IN ('error', 'fatal'))::text AS error_count
        FROM events
        WHERE project_id = ANY(ARRAY[${uuidArray(projectIds)}])
          AND timestamp >= ${toTs(from)}
          AND timestamp <  ${toTs(to)}
        GROUP BY project_id, ts
        ORDER BY ts
    `);

    return rows.map((r) => ({
        projectId: r.project_id,
        ts: new Date(r.ts),
        count: Number(r.count),
        errorCount: Number(r.error_count),
    }));
}
