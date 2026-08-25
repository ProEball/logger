/**
 * Create the two candidate tables and load one corpus into both.
 *
 *   node lab/clickhouse/seed.mjs [--rows 5000000] [--projects 10] [--days 30]
 *
 * `events_b` is filled with `INSERT ... SELECT` from `events_a` rather than by
 * generating twice. Two generations would be identical (the RNG is seeded), but
 * loading once is minutes faster and removes any chance of the two tables
 * holding different data — which is the one thing that would invalidate every
 * comparison the lab makes.
 */

import { generateCorpus, DEFAULTS } from "./corpus.mjs";
import { createTable, CANDIDATES } from "./schema.mjs";
import { exec, rows, one, ping } from "./ch.mjs";

const BATCH_ROWS = 50_000;

function parseArgs(argv) {
    const out = { ...DEFAULTS };
    for (let i = 0; i < argv.length; i += 2) {
        const key = argv[i]?.replace(/^--/, "");
        if (key && key in out) out[key] = Number(argv[i + 1]);
    }
    return out;
}

const fmt = (n) => n.toLocaleString("en-US");

async function main() {
    const options = parseArgs(process.argv.slice(2));

    await ping();
    const { version } = await one("SELECT version() AS version");
    console.log(`ClickHouse ${version}`);
    console.log(`corpus: ${fmt(options.rows)} rows, ${options.projects} projects, ${options.days} days, seed ${options.seed}\n`);

    for (const name of Object.keys(CANDIDATES)) {
        await exec(`DROP TABLE IF EXISTS ${name}`);
        await exec(createTable(name));
        console.log(`created ${name}  ORDER BY ${CANDIDATES[name].orderBy}`);
    }

    // ── load events_a ────────────────────────────────────────────────────────
    console.log(`\nloading events_a …`);
    const started = Date.now();
    let buffer = [];
    let written = 0;

    const flush = async () => {
        if (buffer.length === 0) return;
        // Async insert is what production will use (plan §10). Enabling it here
        // means the lab exercises the same write path rather than a bulk load
        // that hides the part-count behaviour.
        await exec(`INSERT INTO events_a FORMAT JSONEachRow\n${buffer.join("\n")}`, {
            settings: { async_insert: 1, wait_for_async_insert: 1 },
        });
        written += buffer.length;
        buffer = [];
        const elapsed = (Date.now() - started) / 1000;
        process.stdout.write(
            `\r  ${fmt(written)} rows  ${Math.round(written / elapsed).toLocaleString("en-US")}/s  ${elapsed.toFixed(0)}s   `,
        );
    };

    for (const row of generateCorpus(options)) {
        buffer.push(JSON.stringify(row));
        if (buffer.length >= BATCH_ROWS) await flush();
    }
    await flush();
    console.log(`\n  done in ${((Date.now() - started) / 1000).toFixed(0)}s`);

    // ── copy into events_b ───────────────────────────────────────────────────
    //
    // One partition at a time, not one `INSERT … SELECT`.
    //
    // The whole-table form died at 5M rows with MEMORY_LIMIT_EXCEEDED against
    // the 3 GiB ceiling in `config.d/lab.xml` — and the right response was to
    // chunk the copy, not to raise the ceiling. That ceiling is the whole
    // reason the lab's numbers are transferable: it is the share the plan
    // budgets ClickHouse on an 8 GB host shared with Postgres and the app.
    // Loosening it to make the loader convenient would quietly turn every
    // measurement into a statement about a machine nobody is going to run.
    //
    // `message_lower` is MATERIALIZED, so it is absent from `SELECT *` and is
    // recomputed on insert. Listing columns explicitly would break the moment
    // the shared template in schema.mjs gains one.
    console.log(`\ncopying into events_b …`);
    const copyStarted = Date.now();
    // By **day**, not by month.
    //
    // A month-sized chunk was enough at 3 attributes per project and blew the
    // 3 GiB ceiling at 18 (2026-08-26): a wide JSON column materialises one
    // subcolumn per path, and 180 of them make a bulk `INSERT … SELECT`
    // memory-hungry in a way the row count alone does not predict. Reads of the
    // same column peak at under 5 MiB — this is a property of the bulk copy,
    // not of the schema.
    const days = await rows(
        `SELECT DISTINCT toDate(timestamp) AS d FROM events_a ORDER BY d`,
    );
    for (const [i, { d }] of days.entries()) {
        await exec(`INSERT INTO events_b SELECT * FROM events_a WHERE toDate(timestamp) = {d:Date}`, {
            params: { d },
            settings: { max_threads: 2, max_insert_threads: 1, max_block_size: 8192 },
        });
        process.stdout.write(`\r  day ${d} (${i + 1}/${days.length})   `);
    }
    console.log(`\n  done in ${((Date.now() - copyStarted) / 1000).toFixed(0)}s`);

    for (const name of Object.keys(CANDIDATES)) {
        await exec(`OPTIMIZE TABLE ${name} FINAL`);
    }

    const summary = await one(`
        SELECT
            (SELECT count() FROM events_a) AS rows_a,
            (SELECT count() FROM events_b) AS rows_b,
            (SELECT count() FROM system.parts WHERE table = 'events_a' AND active) AS parts_a
    `);
    console.log(`\nevents_a ${fmt(Number(summary.rows_a))} rows in ${summary.parts_a} parts`);
    console.log(`events_b ${fmt(Number(summary.rows_b))} rows`);
    if (summary.rows_a !== summary.rows_b) {
        console.error("\n!! the two tables disagree on row count — every comparison below would be meaningless");
        process.exitCode = 1;
    }
    console.log(`\nnext: node lab/clickhouse/measure.mjs`);
}

main().catch((err) => {
    console.error(`\n${err.message}`);
    process.exit(1);
});
