/**
 * Seeds a large, realistic corpus into a dedicated benchmark database.
 *
 *   npm run bench:seed              # 500k events into logger_bench
 *   BENCH_EVENTS=2000000 npm run bench:seed
 *
 * Separate from `logger_itest` on purpose. That database is rebuilt on every
 * integration run, which is fine for forty rows and absurd for half a million;
 * this one is seeded once and reused until you ask for it to be rebuilt.
 *
 * **Two stores since Phase 4** (docs/features/09-clickhouse.md). Organizations
 * and projects go to Postgres `logger_bench`; the events go to a ClickHouse
 * database of the same name. Both are named by the same `BENCH_DB_NAME`, so
 * pointing the benchmark somewhere else moves both halves together.
 *
 * Two properties matter more than the row count:
 *
 * 1. **Message cardinality.** Messages come from `event-factory.mjs`, which
 *    mixes verbatim repeats, bounded-cardinality templates and effectively
 *    unique strings. An earlier generator emitted twelve fixed strings; the
 *    top-messages aggregate then reported 275 groups on 195k events, which said
 *    nothing whatsoever about real traffic.
 *
 *    What that number *means* changed in Phase 4 and the corpus did not: the
 *    aggregate groups by `template_hash` now, not by 200 characters of text, so
 *    the figure printed at the end is **distinct templates**. It is far smaller
 *    than the distinct-message count, and that gap is the whole point of the
 *    normaliser — a corpus whose two numbers are equal is one where every
 *    message is already unique, and would measure the wrong thing.
 *
 * 2. **Partition placement, which no longer constrains the span.** Postgres
 *    partitioned `events` by day and pg_partman premade seven days either side,
 *    so a corpus wider than that landed in `events_default` and neither pruned
 *    nor parallelised like real data. ClickHouse partitions monthly and creates
 *    partitions on insert, so `BENCH_DAYS` can be widened freely — the only
 *    cost is the insert time.
 */

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { createClient } from "@clickhouse/client";
import { splitDdl } from "../core/clickhouse/ddl.ts";
import {
    buildMessage,
    ENVIRONMENTS,
    pick,
    ROUTES,
    SOURCES,
    weightedLevel,
} from "./event-factory.mjs";
import { uuidv7 } from "../shared/utils/uuidv7.ts";
import { fingerprintMessage } from "../features/ingest/utils/normalize-message.ts";

const DB_NAME = process.env.BENCH_DB_NAME ?? "logger_bench";
const ADMIN_URL = process.env.BENCH_ADMIN_URL ?? "postgresql://postgres:postgres@localhost:5432/postgres";
const DB_URL =
    process.env.BENCH_DATABASE_URL ?? `postgresql://postgres:postgres@localhost:5432/${DB_NAME}`;

const CH_URL = process.env.BENCH_CLICKHOUSE_URL ?? "http://localhost:8123";
const CH_USER = process.env.BENCH_CLICKHOUSE_USER ?? "logger";
const CH_PASSWORD = process.env.BENCH_CLICKHOUSE_PASSWORD ?? "logger";
const CH_DATABASE = process.env.BENCH_CLICKHOUSE_DATABASE ?? DB_NAME;

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

/**
 * The ClickHouse half: create the database, apply the same schema file the
 * bootstrap container applies.
 *
 * The statements are split by the **real** `splitDdl`, imported straight from
 * TypeScript — node strips types on its own. A naive `;` split was tried first
 * and failed on the very first fragment: the file's header comment contains a
 * semicolon, so the parser was handed half a sentence. The splitter is comment-
 * and string-literal-aware and has its own tests; a second copy of it here
 * would be a second thing to get wrong.
 */
async function ensureClickhouse() {
    const admin = createClient({ url: CH_URL, username: CH_USER, password: CH_PASSWORD });
    try {
        await admin.command({ query: `CREATE DATABASE IF NOT EXISTS ${CH_DATABASE}` });
    } finally {
        await admin.close();
    }

    const client = createClient({
        url: CH_URL,
        username: CH_USER,
        password: CH_PASSWORD,
        database: CH_DATABASE,
    });

    for (const statement of splitDdl(readFileSync("./core/clickhouse/schema.sql", "utf8"))) {
        await client.command({ query: statement });
    }

    return client;
}

/**
 * `YYYY-MM-DD HH:mm:ss.SSS`, which is what `DateTime64(3, 'UTC')` accepts.
 * ISO-8601's `T`/`Z` is rejected outright — the same conversion
 * `to-clickhouse-row.ts` makes, restated because this script cannot import it.
 */
function chTimestamp(ms) {
    const iso = new Date(ms).toISOString();
    return `${iso.slice(0, 10)} ${iso.slice(11, 23)}`;
}

function buildRows(projectIds, count, spanMs, endMs) {
    return Array.from({ length: count }, () => {
        const level = weightedLevel();
        const message = buildMessage();
        const fingerprint = fingerprintMessage(message);
        const isError = level === "error" || level === "fatal";

        return {
            id: uuidv7(),
            project_id: pick(projectIds),
            timestamp: chTimestamp(endMs - Math.floor(Math.random() * spanMs)),
            level,
            message,
            source: pick(SOURCES),
            environment: pick(ENVIRONMENTS),
            release: pick(["1.4.0", "1.4.1", "1.5.0-rc1"]),
            error_type: isError ? pick(["TypeError", "TimeoutError", "HttpError"]) : "",
            user_id: `u_${Math.floor(Math.random() * 5000)}`,
            session_id: "",
            request_id: "",
            trace_id: `t_${Math.floor(Math.random() * 1e12).toString(36)}`,
            template_hash: fingerprint.hash.toString(),
            message_template: fingerprint.template,
            attributes: {
                route: pick(ROUTES),
                latency_ms: Math.floor(Math.random() * 3000) + 1,
                cached: Math.random() < 0.5,
            },
            context: "{}",
            stack_trace: "",
            user_agent: "",
            // The column is IPv6 and has no Nullable; `::` is "not known".
            ip: "::",
        };
    });
}

async function main() {
    await ensureDatabase();
    const ch = await ensureClickhouse();
    const sql = postgres(DB_URL, { max: 1, onnotice: () => {} });

    try {
        // The same file the bootstrap container applies; there are no
        // migrations (core/db/bootstrap.ts).
        await sql.unsafe(readFileSync("./db/schema.sql", "utf8")).simple();

        // TRUNCATE, not DELETE. DELETE leaves dead tuples behind, and since
        // this script is re-run to rebuild the corpus, the table would keep
        // growing physically at a constant row count — 265 MB became 481 MB on
        // the second seeding. Every benchmark after that would be scanning
        // more pages for the same data and reporting it as a regression.
        await sql`TRUNCATE organizations, projects CASCADE`;
        // The ClickHouse equivalent, and for the same reason: a re-seed must
        // not leave the previous corpus behind. This database holds nothing but
        // the benchmark corpus, so truncating the whole table is correct here —
        // unlike the integration fixture, which shares its table.
        await ch.command({ query: "TRUNCATE TABLE events" });

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
            await ch.insert({
                table: "events",
                values: buildRows(projectIds, size, spanMs, endMs),
                format: "JSONEachRow",
            });
            const pct = (((done + size) / TOTAL_EVENTS) * 100).toFixed(1);
            process.stdout.write(`\rseeding ${done + size}/${TOTAL_EVENTS} (${pct}%)`);
        }

        process.stdout.write("\n");
        await sql.unsafe("ANALYZE");

        const stats = await queryOne(
            ch,
            `SELECT count() AS events,
                    uniqExact(template_hash) AS templates,
                    uniqExact(message) AS messages
             FROM events`,
        );
        // Storage comes from system.parts rather than from the table: only the
        // active parts count, and a merge that has not run yet would otherwise
        // be reported as corpus size.
        const storage = await queryOne(
            ch,
            `SELECT formatReadableSize(sum(bytes_on_disk)) AS size,
                    round(sum(data_uncompressed_bytes) / sum(data_compressed_bytes), 1) AS ratio
             FROM system.parts
             WHERE database = currentDatabase() AND table = 'events' AND active`,
        );

        console.log(
            `\ndone in ${((Date.now() - started) / 1000).toFixed(1)}s\n` +
                `  events:             ${Number(stats.events).toLocaleString()}\n` +
                `  distinct templates: ${Number(stats.templates).toLocaleString()}  ← the number that decides top-messages cost\n` +
                `  distinct messages:  ${Number(stats.messages).toLocaleString()}  ← what it would be without the normaliser\n` +
                `  table size:         ${storage.size} (compression ${storage.ratio}x)\n` +
                `  projects:           ${projectIds.length}\n` +
                `  span:               ${DAYS} days\n`,
        );
    } finally {
        await sql.end();
        await ch.close();
    }
}

async function queryOne(client, query) {
    const result = await client.query({ query, format: "JSONEachRow" });
    const [row] = await result.json();
    return row;
}

await main();
