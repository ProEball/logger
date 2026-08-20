/**
 * Seeds a large, realistic corpus into a dedicated benchmark database.
 *
 *   npm run bench:seed              # 500k events into logger_bench
 *   BENCH_EVENTS=2000000 npm run bench:seed
 *
 * Separate from `logger_itest` on purpose. That database is dropped and
 * rebuilt on every integration run, which is fine for forty rows and absurd
 * for half a million; this one is seeded once and reused until you ask for it
 * to be rebuilt.
 *
 * Two properties matter more than the row count:
 *
 * 1. **Message cardinality.** Messages come from `event-factory.mjs`, which
 *    mixes verbatim repeats, bounded-cardinality templates and effectively
 *    unique strings. An earlier generator emitted twelve fixed strings; the
 *    top-messages aggregate then reported 275 groups and 77 kB of hash memory
 *    on 195k events, which said nothing whatsoever about real traffic. The
 *    honest figure on the same query was 68,933 groups and 654 ms.
 *
 * 2. **Partition placement.** `events` is partitioned by day and pg_partman
 *    premakes seven days either side. Rows dated outside that window land in
 *    `events_default`, where they neither prune nor parallelise the way real
 *    data does — so the corpus stays inside the last few days by default.
 *    Widen `BENCH_DAYS` only after creating the partitions to match, or the
 *    measurement is of the wrong thing.
 */

import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import {
    buildMessage,
    ENVIRONMENTS,
    pick,
    ROUTES,
    SOURCES,
    weightedLevel,
} from "./event-factory.mjs";

const DB_NAME = process.env.BENCH_DB_NAME ?? "logger_bench";
const ADMIN_URL = process.env.BENCH_ADMIN_URL ?? "postgresql://postgres:postgres@localhost:5432/postgres";
const DB_URL =
    process.env.BENCH_DATABASE_URL ?? `postgresql://postgres:postgres@localhost:5432/${DB_NAME}`;

const TOTAL_EVENTS = Number(process.env.BENCH_EVENTS ?? 500_000);
const DAYS = Number(process.env.BENCH_DAYS ?? 3);
const PROJECT_COUNT = Number(process.env.BENCH_PROJECTS ?? 2);
const BATCH_SIZE = 5_000;

const ORG_ID = "cccccccc-0000-4000-8000-000000000001";

async function ensureDatabase() {
    const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
    try {
        const rows = await admin`SELECT 1 FROM pg_database WHERE datname = ${DB_NAME}`;
        if (rows.length === 0) {
            await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
            console.log(`created database ${DB_NAME}`);
        }
    } finally {
        await admin.end();
    }
}

function buildRows(projectIds, count, spanMs, endMs) {
    return Array.from({ length: count }, () => {
        const level = weightedLevel();
        return {
            id: randomUUID(),
            project_id: pick(projectIds),
            timestamp: new Date(endMs - Math.floor(Math.random() * spanMs)).toISOString(),
            level,
            message: buildMessage(),
            source: pick(SOURCES),
            environment: pick(ENVIRONMENTS),
            release: pick(["1.4.0", "1.4.1", "1.5.0-rc1"]),
            user_id: `u_${Math.floor(Math.random() * 5000)}`,
            trace_id: `t_${Math.floor(Math.random() * 1e12).toString(36)}`,
            error_type: level === "error" || level === "fatal" ? pick(["TypeError", "TimeoutError", "HttpError"]) : null,
            attributes: JSON.stringify({
                route: pick(ROUTES),
                latency_ms: Math.floor(Math.random() * 3000) + 1,
                cached: Math.random() < 0.5,
            }),
        };
    });
}

async function main() {
    await ensureDatabase();

    const sql = postgres(DB_URL, { max: 1, onnotice: () => {} });
    try {
        await sql.unsafe("CREATE EXTENSION IF NOT EXISTS pg_partman");
        await migrate(drizzle(sql), { migrationsFolder: "./core/db/migrations" });

        // TRUNCATE, not DELETE. DELETE leaves dead tuples behind, and since
        // this script is re-run to rebuild the corpus, the table would keep
        // growing physically at a constant row count — 265 MB became 481 MB on
        // the second seeding. Every benchmark after that would be scanning
        // more pages for the same data and reporting it as a regression.
        await sql`TRUNCATE organizations, projects, events, project_environments CASCADE`;

        await sql`
            INSERT INTO organizations (id, name, slug)
            VALUES (${ORG_ID}::uuid, 'Bench Org', 'bench-org')
        `;

        const projectIds = [];
        for (let i = 0; i < PROJECT_COUNT; i++) {
            const id = randomUUID();
            projectIds.push(id);
            await sql`
                INSERT INTO projects (id, organization_id, name, slug)
                VALUES (${id}::uuid, ${ORG_ID}::uuid, ${`Bench ${i + 1}`}, ${`bench-${i + 1}`})
            `;
        }

        const endMs = Date.now();
        const spanMs = DAYS * 24 * 60 * 60 * 1000;
        const started = Date.now();

        for (let done = 0; done < TOTAL_EVENTS; done += BATCH_SIZE) {
            const size = Math.min(BATCH_SIZE, TOTAL_EVENTS - done);
            const rows = buildRows(projectIds, size, spanMs, endMs);
            await sql`
                INSERT INTO events ${sql(
                    rows,
                    "id", "project_id", "timestamp", "level", "message", "source",
                    "environment", "release", "user_id", "trace_id", "error_type", "attributes",
                )}
            `;
            const pct = (((done + size) / TOTAL_EVENTS) * 100).toFixed(1);
            process.stdout.write(`\rseeding ${done + size}/${TOTAL_EVENTS} (${pct}%)`);
        }

        process.stdout.write("\n");

        // Same derivation migration 0007 uses. Without it the benchmark would
        // measure `getOrgEnvironments` against an empty registry and report a
        // speedup that is really just an empty table.
        await sql`
            INSERT INTO project_environments (project_id, environment, first_seen_at, last_seen_at)
            SELECT project_id, environment, MIN(timestamp), MAX(timestamp)
            FROM events
            GROUP BY project_id, environment
            ON CONFLICT ON CONSTRAINT project_environments_project_env_unique DO NOTHING
        `;

        await sql.unsafe("ANALYZE events");
        await sql.unsafe("ANALYZE project_environments");

        const [{ count }] = await sql`SELECT COUNT(*)::text AS count FROM events`;
        const [{ groups }] = await sql`
            SELECT COUNT(*)::text AS groups
            FROM (SELECT 1 FROM events GROUP BY SUBSTRING(message, 1, 200)) g
        `;
        // Summed over the partition tree: `pg_total_relation_size('events')`
        // on the partitioned parent reports the parent's own storage, which is
        // always zero — the rows live in the daily children.
        const [{ size }] = await sql`
            SELECT pg_size_pretty(SUM(pg_total_relation_size(relid))) AS size
            FROM pg_partition_tree('events')
        `;

        console.log(
            `\ndone in ${((Date.now() - started) / 1000).toFixed(1)}s\n` +
                `  events:          ${Number(count).toLocaleString()}\n` +
                `  distinct messages: ${Number(groups).toLocaleString()}  ← the number that decides top-messages cost\n` +
                `  table size:      ${size}\n` +
                `  projects:        ${projectIds.length}\n` +
                `  span:            ${DAYS} days\n`,
        );
    } finally {
        await sql.end();
    }
}

await main();
