import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/core/db/client";
import {
    ENVIRONMENT_KEY_CAP,
    markRollupDirty,
    projectsNeedingRollup,
    pruneRollup,
    rebuildRollupForProject,
} from "@/features/ingest/services/event-rollup.service";
import {
    getOrgEventBuckets,
    getOrgLevelBreakdown,
    getProjectStats,
} from "@/features/overview/services/overview.service";
import {
    eventsPerMinute,
    hasAnyEvents,
    levelBreakdown,
} from "@/features/dashboard/services/aggregations.service";
import { ORG_A } from "@/itest/support/fixture";

/**
 * The rollup, end to end against Postgres.
 *
 * The property that matters is not "the rollup has rows" but **"the rollup
 * agrees with the events it summarises"** — a summary table that quietly
 * disagrees with its source is worse than no summary table, because every
 * number on every dashboard is then confidently wrong. Most of these tests
 * therefore compare a rollup-backed read against a direct count of `events`.
 *
 * Writes, so it owns its project rather than touching the shared fixture.
 */

const projectId = randomUUID();

/** An exact minute boundary, an hour in the past, so buckets are predictable. */
const ANCHOR = new Date(Math.floor((Date.now() - 60 * 60_000) / 60_000) * 60_000);

function at(offsetMinutes: number): Date {
    return new Date(ANCHOR.getTime() + offsetMinutes * 60_000);
}

async function insertEvents(
    specs: Array<{ count: number; level: string; environment: string | null; offsetMinutes: number }>,
): Promise<void> {
    const values = specs.flatMap((spec) =>
        Array.from({ length: spec.count }, () => ({
            id: randomUUID(),
            ts: at(spec.offsetMinutes).toISOString(),
            level: spec.level,
            environment: spec.environment,
        })),
    );
    for (const v of values) {
        await db.execute(sql`
            INSERT INTO events (id, project_id, timestamp, level, message, environment)
            VALUES (${v.id}::uuid, ${projectId}::uuid, ${v.ts}::timestamptz, ${v.level}, 'rollup test', ${v.environment})
        `);
    }
}

/** Rebuild until the project is caught up, as the job does across runs. */
async function rebuildFully(): Promise<void> {
    for (let i = 0; i < 40; i++) {
        const [state] = await db.execute<{ refresh_from: Date }>(sql`
            SELECT refresh_from FROM rollup_state WHERE project_id = ${projectId}::uuid
        `);
        const result = await rebuildRollupForProject(projectId, new Date(state.refresh_from));
        if (!result.hasMore) return;
    }
    throw new Error("rollup did not catch up within 40 runs");
}

async function rawCount(fromMin: number, toMin: number): Promise<number> {
    const [row] = await db.execute<{ n: string }>(sql`
        SELECT COUNT(*)::text AS n FROM events
        WHERE project_id = ${projectId}::uuid
          AND timestamp >= ${at(fromMin).toISOString()}::timestamptz
          AND timestamp <  ${at(toMin).toISOString()}::timestamptz
    `);
    return Number(row.n);
}

beforeAll(async () => {
    await db.execute(sql`
        INSERT INTO projects (id, organization_id, name, slug)
        VALUES (${projectId}::uuid, ${ORG_A}::uuid, 'Rollup Test', ${`rollup-${projectId.slice(0, 8)}`})
    `);
    await db.execute(sql`
        INSERT INTO rollup_state (project_id, refresh_from) VALUES (${projectId}::uuid, ${ANCHOR.toISOString()}::timestamptz)
    `);

    await insertEvents([
        { count: 12, level: "info", environment: "production", offsetMinutes: 0 },
        { count: 3, level: "error", environment: "production", offsetMinutes: 0 },
        { count: 1, level: "fatal", environment: "staging", offsetMinutes: 0 },
        { count: 5, level: "info", environment: null, offsetMinutes: 1 },
        // Minute 2 is deliberately empty — a gap must produce no row at all.
        { count: 7, level: "warn", environment: "production", offsetMinutes: 3 },
    ]);

    await rebuildFully();
});

afterAll(async () => {
    // `events.project_id` is ON DELETE RESTRICT, so the events go first; the
    // rollup and watermark rows cascade with the project.
    await db.execute(sql`DELETE FROM events WHERE project_id = ${projectId}::uuid`);
    await db.execute(sql`DELETE FROM projects WHERE id = ${projectId}::uuid`);
});

describe("rebuildRollupForProject", () => {
    it("writes one row per minute that had events, and none for minutes that did not", async () => {
        const rows = await db.execute<{ minute: Date; total: number }>(sql`
            SELECT minute, total FROM event_rollup_minutes
            WHERE project_id = ${projectId}::uuid ORDER BY minute
        `);
        // Minutes 0, 1 and 3 — never 2. Materialising empty minutes would put
        // 1,440 rows a day behind a project that sent ten events.
        expect(rows.map((r) => Number(r.total))).toEqual([16, 5, 7]);
    });

    it("totals agree with a direct count of events", async () => {
        const [row] = await db.execute<{ n: string }>(sql`
            SELECT SUM(total)::text AS n FROM event_rollup_minutes WHERE project_id = ${projectId}::uuid
        `);
        expect(Number(row.n)).toBe(await rawCount(0, 60));
    });

    it("derives errors from by_level rather than storing them twice", async () => {
        const [row] = await db.execute<{ errors: number; by_level: Record<string, number> }>(sql`
            SELECT errors, by_level FROM event_rollup_minutes
            WHERE project_id = ${projectId}::uuid AND minute = ${at(0).toISOString()}::timestamptz
        `);
        // 3 error + 1 fatal, and the column is GENERATED — the job never writes it.
        expect(Number(row.errors)).toBe(4);
        expect(row.by_level).toMatchObject({ error: 3, fatal: 1, info: 12 });
    });

    it("labels an absent environment '(unset)', as every other read does", async () => {
        const [row] = await db.execute<{ by_env: Record<string, number> }>(sql`
            SELECT by_env FROM event_rollup_minutes
            WHERE project_id = ${projectId}::uuid AND minute = ${at(1).toISOString()}::timestamptz
        `);
        expect(row.by_env).toEqual({ "(unset)": 5 });
    });

    it("never materialises the minute still in progress", async () => {
        const [row] = await db.execute<{ n: string }>(sql`
            SELECT COUNT(*)::text AS n FROM event_rollup_minutes
            WHERE project_id = ${projectId}::uuid AND minute >= date_trunc('minute', now())
        `);
        expect(Number(row.n)).toBe(0);
    });

    it("records how far the rollup is complete to", async () => {
        const [row] = await db.execute<{ rolled_up_to: Date | null }>(sql`
            SELECT rolled_up_to FROM rollup_state WHERE project_id = ${projectId}::uuid
        `);
        expect(row.rolled_up_to).not.toBeNull();
        expect(new Date(row.rolled_up_to!).getTime()).toBeLessThanOrEqual(Date.now());
    });

    it("drops a bucket whose events have gone", async () => {
        // Retention drops event partitions; an upsert-only rebuild would leave
        // the stale count behind and nothing would ever say so.
        await db.execute(sql`
            DELETE FROM events
            WHERE project_id = ${projectId}::uuid AND timestamp = ${at(3).toISOString()}::timestamptz
        `);
        await markRollupDirty(projectId, at(3));
        await rebuildFully();

        const rows = await db.execute<{ minute: Date }>(sql`
            SELECT minute FROM event_rollup_minutes
            WHERE project_id = ${projectId}::uuid AND minute = ${at(3).toISOString()}::timestamptz
        `);
        expect(rows).toHaveLength(0);
    });

    it("is idempotent — rebuilding the same window does not double the counts", async () => {
        await markRollupDirty(projectId, at(0));
        await rebuildFully();
        await markRollupDirty(projectId, at(0));
        await rebuildFully();

        const [row] = await db.execute<{ n: string }>(sql`
            SELECT SUM(total)::text AS n FROM event_rollup_minutes WHERE project_id = ${projectId}::uuid
        `);
        expect(Number(row.n)).toBe(await rawCount(0, 60));
    });

    it("caps the environments kept per minute", async () => {
        const many = Array.from({ length: ENVIRONMENT_KEY_CAP + 5 }, (_, i) => ({
            count: 1,
            level: "info",
            environment: `env-${String(i).padStart(3, "0")}`,
            offsetMinutes: 10,
        }));
        await insertEvents(many);
        await markRollupDirty(projectId, at(10));
        await rebuildFully();

        const [row] = await db.execute<{ by_env: Record<string, number>; total: number }>(sql`
            SELECT by_env, total FROM event_rollup_minutes
            WHERE project_id = ${projectId}::uuid AND minute = ${at(10).toISOString()}::timestamptz
        `);
        const keys = Object.keys(row.by_env);
        expect(keys.length).toBeLessThanOrEqual(ENVIRONMENT_KEY_CAP + 1);
        expect(keys).toContain("(other)");
        // Folding must not lose events — only the labels.
        const summed = Object.values(row.by_env).reduce((a, b) => a + Number(b), 0);
        expect(summed).toBe(Number(row.total));
    });
});

describe("markRollupDirty", () => {
    it("pulls the watermark back for a late event and never forward", async () => {
        await db.execute(sql`
            UPDATE rollup_state SET refresh_from = ${at(30).toISOString()}::timestamptz
            WHERE project_id = ${projectId}::uuid
        `);

        await markRollupDirty(projectId, at(5));
        await markRollupDirty(projectId, at(50));

        const [row] = await db.execute<{ refresh_from: Date }>(sql`
            SELECT refresh_from FROM rollup_state WHERE project_id = ${projectId}::uuid
        `);
        expect(new Date(row.refresh_from).getTime()).toBe(at(5).getTime());
    });

    it("lists a project whose watermark is behind the current minute", async () => {
        await markRollupDirty(projectId, at(0));
        const pending = await projectsNeedingRollup();
        expect(pending.map((p) => p.projectId)).toContain(projectId);
    });
});

describe("reads combine the rollup with the un-rolled-up tail", () => {
    it("counts an event ingested seconds ago, before any rebuild has seen it", async () => {
        // The rollup only holds closed minutes. Without the raw tail the newest
        // minute would be missing from every chart — the minute someone
        // watching an incident cares about most.
        const justNow = new Date();
        await db.execute(sql`
            INSERT INTO events (id, project_id, timestamp, level, message)
            VALUES (${randomUUID()}::uuid, ${projectId}::uuid, ${justNow.toISOString()}::timestamptz, 'error', 'fresh')
        `);

        const range = { from: ANCHOR, to: new Date(Date.now() + 1000) };
        const buckets = await getOrgEventBuckets([projectId], range, 60);
        const total = buckets.reduce((s, b) => s + b.count, 0);

        expect(total).toBe(await rawCount(0, 120));
    });

    it("matches a direct count of events over the whole range", async () => {
        const range = { from: ANCHOR, to: new Date(Date.now() + 1000) };
        const buckets = await getOrgEventBuckets([projectId], range, 3600);
        expect(buckets.reduce((s, b) => s + b.count, 0)).toBe(await rawCount(0, 120));
    });

    it("breaks levels down to the same numbers a raw GROUP BY gives", async () => {
        const range = { from: ANCHOR, to: new Date(Date.now() + 1000) };
        const fromRollup = await getOrgLevelBreakdown([projectId], range);

        const raw = await db.execute<{ level: string; n: string }>(sql`
            SELECT level, COUNT(*)::text AS n FROM events
            WHERE project_id = ${projectId}::uuid
              AND timestamp >= ${ANCHOR.toISOString()}::timestamptz
            GROUP BY level
        `);
        const expected = Object.fromEntries(raw.map((r) => [r.level, Number(r.n)]));

        expect(Object.fromEntries(fromRollup.map((r) => [r.level, r.count]))).toEqual(expected);
    });

    it("gives per-project totals that match a direct count", async () => {
        const range = { from: ANCHOR, to: new Date(Date.now() + 1000) };
        const map = await getProjectStats([projectId], range);

        const [row] = await db.execute<{ total: string; errors: string }>(sql`
            SELECT COUNT(*)::text AS total,
                   COUNT(*) FILTER (WHERE level IN ('error','fatal'))::text AS errors
            FROM events
            WHERE project_id = ${projectId}::uuid
              AND timestamp >= ${ANCHOR.toISOString()}::timestamptz
        `);

        expect(map.get(projectId)?.totalEvents).toBe(Number(row.total));
        expect(map.get(projectId)?.errorCount).toBe(Number(row.errors));
    });

    // Removed 2026-08-20: "applies a level filter through by_level rather than
    // falling back". It covered the `levelKeys` branch of the rollup CTE, which
    // unrolled `by_level` per minute to serve the overview's level filter. Both
    // are gone — the filter was removed (see `OverviewFilterBar.tsx`) and the
    // branch with it, so the rollup read is now the plain `SUM(total)`,
    // `SUM(errors)` path. The property that survived — rollup-backed counts
    // matching a direct count of `events` — is asserted by the test above.

    /**
     * The project dashboard's three rollup-backed reads, added 2026-08-21 with
     * §16.2 item 5.
     *
     * They belong **here** rather than in `aggregations.service.itest.ts`
     * because that file runs against the shared fixture, which inserts events
     * directly and never builds a rollup — so `rollupBoundary` is null there
     * and every read falls back to raw `events`. Those tests would pass without
     * executing one line of the new code. This file owns a project and rebuilds
     * the rollup for real, which is the only place the union is exercised.
     */
    it("buckets events per minute to the same totals a raw count gives", async () => {
        const range = { type: "custom" as const, from: ANCHOR.toISOString(), to: new Date(Date.now() + 1000).toISOString() };
        const buckets = await eventsPerMinute(projectId, range);

        expect(buckets.reduce((s, b) => s + b.total, 0)).toBe(await rawCount(0, 120));
    });

    it("splits each bucket by level exactly as the raw rows do", async () => {
        const range = { type: "custom" as const, from: ANCHOR.toISOString(), to: new Date(Date.now() + 1000).toISOString() };
        const buckets = await eventsPerMinute(projectId, range);

        const summed: Record<string, number> = {};
        for (const b of buckets) {
            for (const [level, n] of Object.entries(b.byLevel)) {
                summed[level] = (summed[level] ?? 0) + n;
            }
        }

        const raw = await db.execute<{ level: string; n: string }>(sql`
            SELECT level, COUNT(*)::text AS n FROM events
            WHERE project_id = ${projectId}::uuid
              AND timestamp >= ${ANCHOR.toISOString()}::timestamptz
            GROUP BY level
        `);

        expect(summed).toEqual(Object.fromEntries(raw.map((r) => [r.level, Number(r.n)])));
    });

    it("breaks the dashboard's levels down to the raw numbers too", async () => {
        const range = { type: "custom" as const, from: ANCHOR.toISOString(), to: new Date(Date.now() + 1000).toISOString() };
        const fromRollup = await levelBreakdown(projectId, range);

        const raw = await db.execute<{ level: string; n: string }>(sql`
            SELECT level, COUNT(*)::text AS n FROM events
            WHERE project_id = ${projectId}::uuid
              AND timestamp >= ${ANCHOR.toISOString()}::timestamptz
            GROUP BY level
        `);

        expect(Object.fromEntries(fromRollup.map((r) => [r.level, r.count]))).toEqual(
            Object.fromEntries(raw.map((r) => [r.level, Number(r.n)])),
        );
    });

    it("still orders the dashboard's levels numerically off the rollup", async () => {
        const range = { type: "custom" as const, from: ANCHOR.toISOString(), to: new Date(Date.now() + 1000).toISOString() };
        const counts = (await levelBreakdown(projectId, range)).map((r) => r.count);

        // The union re-aggregates, so the ORDER BY had to move from COUNT(*) to
        // SUM(n). Getting that wrong would reintroduce the text-alias defect
        // through the back door.
        expect(counts).toEqual([...counts].sort((a, b) => b - a));
    });

    it("reports a project with rollup rows as non-empty", async () => {
        expect(await hasAnyEvents(projectId)).toBe(true);
    });

    it("reports a project with neither rollup rows nor events as empty", async () => {
        expect(await hasAnyEvents(randomUUID())).toBe(false);
    });

    it("lists the same environments a direct DISTINCT gives", async () => {
        // Deliberately excludes minute 10, where an earlier test inserted more
        // environments than the cap allows. Below the cap the rollup-backed
        // list must match `SELECT DISTINCT environment` exactly.
        const range = { from: ANCHOR, to: at(5) };
        const map = await getProjectStats([projectId], range);

        const raw = await db.execute<{ environment: string }>(sql`
            SELECT DISTINCT environment FROM events
            WHERE project_id = ${projectId}::uuid
              AND timestamp >= ${ANCHOR.toISOString()}::timestamptz
              AND timestamp <  ${at(5).toISOString()}::timestamptz
              AND environment IS NOT NULL
        `);
        const expected = raw.map((r) => r.environment).sort();

        expect(map.get(projectId)?.environments).toEqual(expected);
    });

    it("shows '(other)' rather than pretending a capped project has fewer environments", async () => {
        // Above the cap the list stops being the raw DISTINCT — that is the
        // trade the cap buys, and hiding the fold would make the pills claim a
        // project uses fewer environments than it does.
        const range = { from: at(9), to: at(11) };
        const envs = (await getProjectStats([projectId], range)).get(projectId)?.environments ?? [];

        expect(envs.length).toBeLessThanOrEqual(ENVIRONMENT_KEY_CAP + 1);
        expect(envs).toContain("(other)");
    });

    it("falls back to raw events for per-project stats under an environment filter", async () => {
        // `by_env` has totals per environment and `by_level` totals per level;
        // "errors in production" needs both at once, which marginals cannot
        // give. That read has to reach `events`.
        const range = { from: ANCHOR, to: new Date(Date.now() + 1000) };
        const map = await getProjectStats([projectId], range, ["production"]);

        const [row] = await db.execute<{ total: string; errors: string }>(sql`
            SELECT COUNT(*)::text AS total,
                   COUNT(*) FILTER (WHERE level IN ('error','fatal'))::text AS errors
            FROM events
            WHERE project_id = ${projectId}::uuid
              AND timestamp >= ${ANCHOR.toISOString()}::timestamptz
              AND environment = 'production'
        `);

        expect(map.get(projectId)?.totalEvents).toBe(Number(row.total));
        expect(map.get(projectId)?.errorCount).toBe(Number(row.errors));
    });

    it("falls back to raw events when an environment filter needs the joint distribution", async () => {
        const range = { from: ANCHOR, to: new Date(Date.now() + 1000) };
        const filtered = await getOrgLevelBreakdown([projectId], range, ["production"]);

        const raw = await db.execute<{ level: string; n: string }>(sql`
            SELECT level, COUNT(*)::text AS n FROM events
            WHERE project_id = ${projectId}::uuid
              AND timestamp >= ${ANCHOR.toISOString()}::timestamptz
              AND environment = 'production'
            GROUP BY level
        `);
        const expected = Object.fromEntries(raw.map((r) => [r.level, Number(r.n)]));

        expect(Object.fromEntries(filtered.map((r) => [r.level, r.count]))).toEqual(expected);
    });
});

describe("pruneRollup", () => {
    it("removes buckets older than the retention window", async () => {
        await db.execute(sql`
            INSERT INTO event_rollup_minutes (project_id, minute, total, by_level, by_env)
            VALUES (${projectId}::uuid, now() - interval '31 days', 5, '{"info":5}'::jsonb, '{}'::jsonb)
        `);

        await pruneRollup();

        const [row] = await db.execute<{ n: string }>(sql`
            SELECT COUNT(*)::text AS n FROM event_rollup_minutes
            WHERE project_id = ${projectId}::uuid AND minute < now() - interval '30 days'
        `);
        expect(Number(row.n)).toBe(0);
    });
});
