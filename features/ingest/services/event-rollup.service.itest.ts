import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { EVENT_LEVELS } from "@/shared/utils/event-filters.schema";
import { templateHashForStorage } from "@/features/ingest/utils/normalize-message";
import { topMessages, topSources } from "@/features/dashboard/services/aggregations.service";
import { getProjectTopMessages } from "@/features/overview/services/overview.service";
import { templateCoverage } from "@/shared/services/rollup-boundary.service";
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
    specs: Array<{
        count: number;
        level: string;
        environment: string | null;
        offsetMinutes: number;
        /**
         * Defaults to a fixed string, so existing cases keep one template. Pass
         * a message to exercise the template rollup; pass `null` to write an
         * event with **no** fingerprint, standing in for one ingested before
         * the column existed.
         */
        message?: string | null;
    }>,
): Promise<void> {
    const values = specs.flatMap((spec) =>
        Array.from({ length: spec.count }, () => ({
            id: randomUUID(),
            ts: at(spec.offsetMinutes).toISOString(),
            level: spec.level,
            environment: spec.environment,
            message: spec.message === undefined ? "rollup test" : spec.message,
        })),
    );
    for (const v of values) {
        // `null` message means "legacy row": stored text, no fingerprint. The
        // hash is computed here rather than by ingest because this fixture
        // writes raw SQL — the point is to reproduce what the column holds, not
        // to re-test how it gets there.
        const hash = v.message === null ? null : templateHashForStorage(v.message).toString();
        await db.execute(sql`
            INSERT INTO events (id, project_id, timestamp, level, message, environment, template_hash)
            VALUES (
                ${v.id}::uuid, ${projectId}::uuid, ${v.ts}::timestamptz, ${v.level},
                ${v.message ?? "legacy event"}, ${v.environment},
                ${hash}::bigint
            )
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
        // Carries a fingerprint, like every event ingest writes. Without one
        // this row silently became the oldest unfingerprinted event in the
        // project and pushed `templateCoverage` floor up for every test after
        // it — a fixture that did not match production.
        await db.execute(sql`
            INSERT INTO events (id, project_id, timestamp, level, message, template_hash)
            VALUES (
                ${randomUUID()}::uuid, ${projectId}::uuid, ${justNow.toISOString()}::timestamptz,
                'error', 'fresh', ${templateHashForStorage('fresh').toString()}::bigint
            )
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

/**
 * The template rollup, built in the same transaction and the same window as the
 * one above. These live here rather than beside `aggregations.service.ts` for
 * the reason recorded in `PLAN.md` §17 on 2026-08-21: the shared itest fixture
 * never builds a rollup, so tests written there would pass without executing a
 * single line of this code.
 */
describe("rebuildRollupForProject — templates", () => {
    it("writes one row per template per minute, not one per event", async () => {
        const rows = await db.execute<{ n: string }>(sql`
            SELECT count(*)::text AS n FROM event_template_rollup
            WHERE project_id = ${projectId}::uuid
        `);
        // The fixture's events all carry the same message, so however many were
        // written they collapse to one template per minute that had any.
        const minutes = await db.execute<{ n: string }>(sql`
            SELECT count(DISTINCT minute)::text AS n FROM event_template_rollup
            WHERE project_id = ${projectId}::uuid
        `);
        expect(Number(rows[0].n)).toBe(Number(minutes[0].n));
    });

    it("counts agree with a direct count of the events behind them", async () => {
        const [rollup] = await db.execute<{ n: string }>(sql`
            SELECT COALESCE(SUM(count), 0)::text AS n FROM event_template_rollup
            WHERE project_id = ${projectId}::uuid
        `);
        const [raw] = await db.execute<{ n: string }>(sql`
            SELECT count(*)::text AS n FROM events
            WHERE project_id = ${projectId}::uuid
              AND template_hash IS NOT NULL
              AND timestamp < date_trunc('minute', now())
        `);
        expect(rollup.n).toBe(raw.n);
    });

    it("keeps per-level counts, so the badge survives the rollup", async () => {
        const [row] = await db.execute<{ by_level: Record<string, number> }>(sql`
            SELECT by_level FROM event_template_rollup
            WHERE project_id = ${projectId}::uuid
            ORDER BY count DESC LIMIT 1
        `);
        expect(Object.keys(row.by_level).length).toBeGreaterThan(0);
    });

    it("records the coverage interval, not just an upper bound", async () => {
        const [row] = await db.execute<{ from_ts: Date | null; to_ts: Date | null }>(sql`
            SELECT templates_rolled_up_from AS from_ts, templates_rolled_up_to AS to_ts
            FROM rollup_state WHERE project_id = ${projectId}::uuid
        `);
        expect(row.from_ts).not.toBeNull();
        expect(row.to_ts).not.toBeNull();
        expect(new Date(row.from_ts as Date).getTime()).toBeLessThan(
            new Date(row.to_ts as Date).getTime(),
        );
    });

    it("is idempotent — rebuilding the same window does not double the counts", async () => {
        const before = await db.execute<{ n: string }>(sql`
            SELECT COALESCE(SUM(count), 0)::text AS n FROM event_template_rollup
            WHERE project_id = ${projectId}::uuid
        `);
        await markRollupDirty(projectId, at(0));
        await rebuildFully();
        const after = await db.execute<{ n: string }>(sql`
            SELECT COALESCE(SUM(count), 0)::text AS n FROM event_template_rollup
            WHERE project_id = ${projectId}::uuid
        `);
        expect(after[0].n).toBe(before[0].n);
    });
});



/**
 * The read path. Tested here rather than beside the aggregation service because
 * the shared fixture never builds a rollup, so `templateCoverage` returns null
 * there and `topMessages` would take the fallback branch — passing without
 * executing a line of the rollup implementation.
 *
 * **The fixture makes the two paths give different text.** Events carry
 * `User u_487 signed in`; the registered template is `User *** signed in`. The
 * rollup path reports the template, the fallback reports the raw message, and
 * that difference is the only thing that can prove which branch ran. An earlier
 * version used a message identical to its own template — both paths agreed,
 * both breaks of the dispatcher passed, and the tests measured nothing.
 *
 * The two describes below run in order and share a project: the first asserts
 * behaviour while every event is fingerprinted, the second inserts one that is
 * not and asserts the fallback then engages. State is sequential on purpose —
 * it is the same project moving between the two conditions, which is what
 * happens in production.
 */
describe("topMessages over the template rollup", () => {
    const RAW = "User u_487 signed in";
    const TEMPLATE = "User *** signed in";

    beforeAll(async () => {
        await insertEvents([
            { count: 6, level: "error", environment: "production", offsetMinutes: 3, message: RAW },
        ]);
        await db.execute(sql`
            INSERT INTO message_templates (project_id, template_hash, template, normalizer_version)
            VALUES (
                ${projectId}::uuid,
                ${templateHashForStorage(RAW).toString()}::bigint,
                ${TEMPLATE},
                1
            )
            ON CONFLICT DO NOTHING
        `);
        await markRollupDirty(projectId, at(0));
        await rebuildFully();
    });

    describe("while every event carries a fingerprint", () => {
        it("reports no floor at all, because nothing is left uncovered", async () => {
            const c = await templateCoverage(projectId);
            expect(c).not.toBeNull();
            expect(c!.from).toBeNull();
        });

        /**
         * The regression this exists for. Until 2026-08-24 the floor was
         * `templates_rolled_up_from` compared against the start of the window,
         * so a range beginning before the first event ever recorded took the
         * raw-text fallback — for a gap that contained no events. On staging
         * that cost 8.6 s a read to be conservative about nothing.
         */
        it("uses the rollup for a range starting long before any event exists", async () => {
            const c = await templateCoverage(projectId);
            const longBefore = new Date(at(0).getTime() - 365 * 86_400_000);

            const rows = await topMessages(
                projectId,
                { type: "custom", from: longBefore.toISOString(), to: c!.to.toISOString() },
                10,
            );

            // The template, not the raw message: the rollup answered.
            expect(rows.some((r) => r.message === TEMPLATE)).toBe(true);
            expect(rows.some((r) => r.message === RAW)).toBe(false);
        });

        it("reports the template with the right count", async () => {
            const c = await templateCoverage(projectId);
            const rows = await topMessages(
                projectId,
                { type: "custom", from: at(0).toISOString(), to: c!.to.toISOString() },
                10,
            );

            const found = rows.find((r) => r.message === TEMPLATE);
            expect(found).toBeDefined();
            expect(found!.count).toBe(6);
        });
    });

    describe("once an event without a fingerprint exists", () => {
        beforeAll(async () => {
            // `message: null` writes a row with text but no hash — a legacy
            // event, the only thing that can force the fallback.
            await insertEvents([
                { count: 1, level: "info", environment: null, offsetMinutes: 5, message: null },
            ]);
        });

        it("puts the floor above the unfingerprinted event", async () => {
            const c = await templateCoverage(projectId);
            expect(c!.from).not.toBeNull();
            expect(c!.from!.getTime()).toBeGreaterThanOrEqual(at(5).getTime());
        });

        it("falls back to raw text for a range reaching below the floor", async () => {
            const c = await templateCoverage(projectId);
            const below = new Date(c!.from!.getTime() - 86_400_000);

            const rows = await topMessages(
                projectId,
                { type: "custom", from: below.toISOString(), to: c!.to.toISOString() },
                10,
            );

            // The fallback groups the message itself, so the identifier survives.
            expect(rows.some((r) => r.message === RAW)).toBe(true);
            expect(rows.some((r) => r.message === TEMPLATE)).toBe(false);
        });

        /**
         * Two implementations of one question must not disagree on the numbers.
         * Counts come from pre-aggregated integers on one path and from grouping
         * 200 characters of text on the other.
         */
        it("agrees with the raw-text implementation on the count and the badge", async () => {
            const c = await templateCoverage(projectId);
            const viaRollup = (
                await topMessages(
                    projectId,
                    { type: "custom", from: c!.from!.toISOString(), to: c!.to.toISOString() },
                    10,
                )
            ).find((r) => r.message === TEMPLATE);

            const below = new Date(c!.from!.getTime() - 86_400_000);
            const viaEvents = (
                await topMessages(
                    projectId,
                    { type: "custom", from: below.toISOString(), to: c!.to.toISOString() },
                    10,
                )
            ).find((r) => r.message === RAW);

            expect(viaRollup).toBeUndefined();
            expect(viaEvents!.count).toBe(6);
            expect(viaEvents!.dominantLevel).toBe("error");
        });
    });
});

/**
 * Every level must survive the trip through the rollup, on the rollup path.
 *
 * There was already a drift test shaped like this — in
 * `aggregations.service.itest.ts` — but it runs against the shared fixture,
 * where nothing builds a rollup, so it only ever exercised the raw-text
 * fallback and its five `COUNT(*) FILTER` counters. When `by_level` was
 * unpacked into `n_debug`..`n_fatal` on 2026-08-24, the rollup path's own
 * level handling was covered by exactly one assertion, that a single all-error
 * message badges as "error". Swapping `n_debug` and `n_info` in either the
 * SQL or `levelCounts` would have passed it.
 *
 * One message per level, all events of that level, so the badge has to be that
 * level. A mislabelled column moves a count to the wrong name and the badge
 * moves with it.
 */
describe("every level survives the template rollup", () => {
    /** `Cache miss for debug_k` normalises to `Cache miss for ***`. */
    const rawFor = (level: string) => `Cache ${level} for key_${level}9`;
    const templateFor = (level: string) => `Cache ${level} for ***`;

    beforeAll(async () => {
        for (const [i, level] of EVENT_LEVELS.entries()) {
            const raw = rawFor(level);
            await insertEvents([
                {
                    count: 2,
                    level,
                    environment: "production",
                    offsetMinutes: 20 + i,
                    message: raw,
                },
            ]);
            await db.execute(sql`
                INSERT INTO message_templates (project_id, template_hash, template, normalizer_version)
                VALUES (
                    ${projectId}::uuid,
                    ${templateHashForStorage(raw).toString()}::bigint,
                    ${templateFor(level)},
                    1
                )
                ON CONFLICT DO NOTHING
            `);
        }
        await markRollupDirty(projectId, at(0));
        await rebuildFully();
    });

    it.each([...EVENT_LEVELS])("badges a %s-only message as %s", async (level) => {
        // The range is taken from coverage rather than a preset. An earlier
        // block in this file writes an unfingerprinted event on purpose, which
        // raises the floor — so a 30-day preset starts below it and the
        // dispatcher correctly takes the raw-text fallback, where these
        // templates do not exist. That is the dispatcher working, not a bug,
        // and it cost a confusing red run to notice.
        const c = await templateCoverage(projectId);
        const rows = await topMessages(
            projectId,
            { type: "custom", from: c!.from!.toISOString(), to: c!.to.toISOString() },
            200,
        );
        const row = rows.find((r) => r.message === templateFor(level));

        // Finding the row at all proves the rollup path ran: the raw text
        // carries key_<level>9 and only the template drops it.
        expect(row, `no rollup row for ${level}`).toBeDefined();
        expect(row!.count).toBe(2);
        expect(row!.dominantLevel).toBe(level);
    });
});

/**
 * The same, for the **raw tail** — the events above the rollup ceiling.
 *
 * Added immediately after the block above failed to earn its keep. Replacing
 * the tail's `COUNT(*) FILTER (WHERE e.level = 'fatal')` with a literal zero
 * broke nothing: every test took a range ending at `coverage.to`, so the tail
 * window was empty and its five counters were never executed. Exactly the shape
 * this repository has recorded twice — a green test over code that does not run.
 *
 * The tail matters more than its size suggests. It is the newest minute, which
 * is the minute someone watching an incident is looking at, and a level miscount
 * there is invisible everywhere else.
 */
describe("every level survives the raw tail", () => {
    const rawFor = (level: string) => `Tail ${level} for key_${level}7`;
    const templateFor = (level: string) => `Tail ${level} for ***`;

    /** Set in beforeAll: the rollup ceiling these events are written above. */
    let ceiling: Date;

    beforeAll(async () => {
        const c = await templateCoverage(projectId);
        ceiling = c!.to;

        for (const [i, level] of EVENT_LEVELS.entries()) {
            const raw = rawFor(level);
            // Above the ceiling on purpose, and deliberately **not** rebuilt
            // afterwards, so these can only be answered by the tail branch.
            const ts = new Date(ceiling.getTime() + (i + 1) * 1000);
            await db.execute(sql`
                INSERT INTO events (id, project_id, timestamp, level, message, template_hash)
                VALUES (
                    ${randomUUID()}::uuid, ${projectId}::uuid, ${ts.toISOString()}::timestamptz,
                    ${level}, ${raw}, ${templateHashForStorage(raw).toString()}::bigint
                )
            `);
            await db.execute(sql`
                INSERT INTO message_templates (project_id, template_hash, template, normalizer_version)
                VALUES (
                    ${projectId}::uuid,
                    ${templateHashForStorage(raw).toString()}::bigint,
                    ${templateFor(level)},
                    1
                )
                ON CONFLICT DO NOTHING
            `);
        }
    });

    it("puts the tail events above the rollup ceiling", async () => {
        // A guard on the guard. If a later change moved the ceiling past these
        // events, every assertion below would pass through the rollup branch
        // and prove nothing about the tail.
        const [row] = await db.execute<{ n: string }>(sql`
            SELECT COUNT(*)::text AS n FROM event_template_rollup
            WHERE project_id = ${projectId}::uuid AND minute >= ${ceiling.toISOString()}::timestamptz
        `);
        expect(Number(row.n)).toBe(0);
    });

    it.each([...EVENT_LEVELS])("badges a %s-only tail message as %s", async (level) => {
        const c = await templateCoverage(projectId);
        const rows = await topMessages(
            projectId,
            {
                type: "custom",
                from: c!.from!.toISOString(),
                // Past the ceiling, so the tail branch has a window to cover.
                to: new Date(ceiling.getTime() + 60_000).toISOString(),
            },
            200,
        );
        const row = rows.find((r) => r.message === templateFor(level));

        expect(row, `no tail row for ${level}`).toBeDefined();
        expect(row!.count).toBe(1);
        expect(row!.dominantLevel).toBe(level);
    });
});

/**
 * The org overview's per-project top message, served from the template rollup.
 *
 * Same discriminator as the dashboard's tests: events carry `User u_487 signed
 * in` while the registered template is `User *** signed in`, so the returned
 * *text* proves which implementation ran. Asserting only on counts would pass
 * with the dispatcher disabled entirely.
 */
describe("getProjectTopMessages over the template rollup", () => {
    const RAW = "Payment pay_77x1 declined";
    const TEMPLATE = "Payment *** declined";

    beforeAll(async () => {
        await insertEvents([
            { count: 9, level: "error", environment: "production", offsetMinutes: 8, message: RAW },
        ]);
        await db.execute(sql`
            INSERT INTO message_templates (project_id, template_hash, template, normalizer_version)
            VALUES (
                ${projectId}::uuid,
                ${templateHashForStorage(RAW).toString()}::bigint,
                ${TEMPLATE},
                1
            )
            ON CONFLICT DO NOTHING
        `);
        await markRollupDirty(projectId, at(0));
        await rebuildFully();
    });

    it("reports the template, proving the rollup answered", async () => {
        const c = await templateCoverage(projectId);
        const map = await getProjectTopMessages([projectId], { from: c!.from ?? at(0), to: c!.to });

        expect(map.get(projectId)?.message).toBe(TEMPLATE);
    });

    it("badges it from summed by_level, not from mode()", async () => {
        const c = await templateCoverage(projectId);
        const map = await getProjectTopMessages([projectId], { from: c!.from ?? at(0), to: c!.to });

        expect(map.get(projectId)?.level).toBe("error");
    });

    /**
     * The rollup stores no environment, so a filtered question cannot be
     * answered from it at all. This is not a coverage decision — it is the
     * table's shape — and getting it wrong would silently ignore the filter.
     */
    it("falls back to raw text as soon as an environment filter is applied", async () => {
        const c = await templateCoverage(projectId);
        const map = await getProjectTopMessages([projectId], { from: c!.from ?? at(0), to: c!.to }, [
            "production",
        ]);

        expect(map.get(projectId)?.message).toBe(RAW);
    });
});

/**
 * `topSources` over the rollup.
 *
 * The hard part is not correctness but **proving which implementation ran**.
 * Both paths return the same source names and the same counts, so a test that
 * only checks the numbers passes with the dispatcher deleted — the exact trap
 * the template-rollup tests fell into first time round, where the fixture's
 * message equalled its own template.
 *
 * The discriminator here is a sentinel key written straight into
 * `by_source`, disagreeing with the events underneath it. Only the rollup path
 * can return it, and only the fallback can miss it. Writing a rollup row that
 * contradicts its source events is not something the job can do; that is the
 * point, and PROJECT.md §11 permits direct SQL in an integration fixture for
 * precisely this.
 */
describe("topSources over the rollup", () => {
    const MINUTE = 30;
    const SENTINEL = "__rollup_only__";

    async function insertWithSource(source: string, count: number, offsetMinutes: number) {
        for (let i = 0; i < count; i++) {
            await db.execute(sql`
                INSERT INTO events (id, project_id, timestamp, level, message, source, template_hash)
                VALUES (
                    ${randomUUID()}::uuid, ${projectId}::uuid,
                    ${at(offsetMinutes).toISOString()}::timestamptz,
                    'info', 'source test', ${source},
                    ${templateHashForStorage("source test").toString()}::bigint
                )
            `);
        }
    }

    beforeAll(async () => {
        await insertWithSource("api", 5, MINUTE);
        await insertWithSource("worker", 2, MINUTE);
        // A NULL source has to become '(unknown)' on both paths, or the two
        // implementations disagree on a row that is common in real data.
        await db.execute(sql`
            INSERT INTO events (id, project_id, timestamp, level, message, source, template_hash)
            VALUES (
                ${randomUUID()}::uuid, ${projectId}::uuid,
                ${at(MINUTE).toISOString()}::timestamptz,
                'info', 'source test', NULL,
                ${templateHashForStorage("source test").toString()}::bigint
            )
        `);
        await markRollupDirty(projectId, at(MINUTE));
        await rebuildFully();
    });

    /** A range wholly inside the rollup's coverage. */
    const covered = async () => {
        const [row] = await db.execute<{ rolled_up_to: Date }>(sql`
            SELECT rolled_up_to FROM rollup_state WHERE project_id = ${projectId}::uuid
        `);
        return {
            type: "custom" as const,
            from: at(MINUTE).toISOString(),
            to: new Date(row.rolled_up_to).toISOString(),
        };
    };

    it("writes a by_source object rather than leaving it empty", async () => {
        const [row] = await db.execute<{ by_source: Record<string, number> }>(sql`
            SELECT by_source FROM event_rollup_minutes
            WHERE project_id = ${projectId}::uuid AND minute = ${at(MINUTE).toISOString()}::timestamptz
        `);
        expect(row.by_source).toMatchObject({ api: 5, worker: 2, "(unknown)": 1 });
    });

    it("agrees with a direct count of events", async () => {
        const rows = await topSources(projectId, await covered(), 50);
        const byName = new Map(rows.map((r) => [r.source, r.count]));

        expect(byName.get("api")).toBe(5);
        expect(byName.get("worker")).toBe(2);
        expect(byName.get("(unknown)")).toBe(1);
    });

    it("reads the rollup rather than the events under it", async () => {
        await db.execute(sql`
            UPDATE event_rollup_minutes
            SET by_source = by_source || ${JSON.stringify({ [SENTINEL]: 4 })}::jsonb
            WHERE project_id = ${projectId}::uuid AND minute = ${at(MINUTE).toISOString()}::timestamptz
        `);
        try {
            const rows = await topSources(projectId, await covered(), 50);
            // No event carries this source. Only the rollup can produce it.
            expect(rows.find((r) => r.source === SENTINEL)?.count).toBe(4);
        } finally {
            await db.execute(sql`
                UPDATE event_rollup_minutes
                SET by_source = by_source - ${SENTINEL}
                WHERE project_id = ${projectId}::uuid AND minute = ${at(MINUTE).toISOString()}::timestamptz
            `);
        }
    });

    it("falls back to events while any row in reach predates by_source", async () => {
        // What migration 0013 leaves behind until the job rebuilds the row.
        await db.execute(sql`
            UPDATE event_rollup_minutes
            SET by_source = '{}'::jsonb, by_env = by_env || ${JSON.stringify({ __sentinel__: 1 })}::jsonb
            WHERE project_id = ${projectId}::uuid AND minute = ${at(MINUTE).toISOString()}::timestamptz
        `);
        try {
            const rows = await topSources(projectId, await covered(), 50);
            const byName = new Map(rows.map((r) => [r.source, r.count]));

            // Served from events, so the counts are still right — which is the
            // whole point of falling back rather than reading an empty object
            // and reporting that the sources vanished.
            expect(byName.get("api")).toBe(5);
            expect(byName.get("worker")).toBe(2);
        } finally {
            await db.execute(sql`
                UPDATE event_rollup_minutes
                SET by_source = ${JSON.stringify({ api: 5, worker: 2, "(unknown)": 1 })}::jsonb,
                    by_env = by_env - '__sentinel__'
                WHERE project_id = ${projectId}::uuid AND minute = ${at(MINUTE).toISOString()}::timestamptz
            `);
        }
    });
});
