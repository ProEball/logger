/**
 * Experiment 6 — does `insert_deduplication_token` survive `async_insert`?
 *
 * `docs/features/09-clickhouse.md` §10 adopts the token so that an SDK retry
 * after a timeout does not become a duplicate event, and §13 marks its
 * interaction with async insert as version-dependent and unmeasured. §14.7
 * still lists it unanswered, and it blocks Phase 2 — the write path is exactly
 * where the answer is spent.
 *
 * This is a behaviour probe, not a benchmark: every arm inserts the same tiny
 * batch twice and counts rows. Read the verdict column, not the clock.
 *
 * Run against the dev ClickHouse (docker-compose.dev.yml):
 *     node lab/clickhouse/probe-dedup.mjs
 */

import { exec, one, ping } from "./ch.mjs";

const ARMS = [
    {
        name: "no-window / sync",
        settings: "",
        insert: { insert_deduplication_token: "tok-a" },
        expectation: "no dedup — a plain MergeTree remembers nothing",
    },
    {
        name: "window=100 / sync",
        settings: "SETTINGS non_replicated_deduplication_window = 100",
        insert: { insert_deduplication_token: "tok-a" },
        expectation: "dedup",
    },
    {
        name: "window=100 / async, wait=1",
        settings: "SETTINGS non_replicated_deduplication_window = 100",
        insert: { insert_deduplication_token: "tok-a", async_insert: 1, wait_for_async_insert: 1 },
        expectation: "the question this probe exists for",
    },
    {
        name: "window=100 / async + async_insert_deduplicate",
        settings: "SETTINGS non_replicated_deduplication_window = 100",
        insert: {
            insert_deduplication_token: "tok-a",
            async_insert: 1,
            wait_for_async_insert: 1,
            async_insert_deduplicate: 1,
        },
        expectation: "the documented knob — its description says 'replicated table'",
    },
];

/** Two rows, one partition, deliberately trivial. */
function batch(marker) {
    return [
        { id: 1, ts: "2026-08-26 10:00:00", marker },
        { id: 2, ts: "2026-08-26 10:00:01", marker },
    ]
        .map((r) => JSON.stringify(r))
        .join("\n");
}

async function createTable(table, settings) {
    await exec(`DROP TABLE IF EXISTS ${table}`);
    await exec(`
        CREATE TABLE ${table} (id UInt32, ts DateTime, marker String)
        ENGINE = MergeTree PARTITION BY toYYYYMM(ts) ORDER BY (id, ts)
        ${settings}
    `);
}

async function insert(table, ndjson, settings) {
    await exec(`INSERT INTO ${table} FORMAT JSONEachRow\n${ndjson}`, { settings });
}

async function count(table) {
    const row = await one(`SELECT count() AS n FROM ${table}`);
    return Number(row.n);
}

async function runArm(arm, index) {
    const table = `probe_dedup_${index}`;
    await createTable(table, arm.settings);

    // The same batch, twice, with the same token — an SDK retrying a request
    // whose response it never saw.
    await insert(table, batch("first"), arm.insert);
    await insert(table, batch("first"), arm.insert);
    const afterRetry = await count(table);

    // A different token — a genuinely new batch must never be swallowed.
    await insert(table, batch("second"), { ...arm.insert, insert_deduplication_token: "tok-b" });
    const afterNewToken = await count(table);

    // The same token as the first, but *different* data. The token is
    // documented to win over the block checksum, so this should be dropped —
    // which is the hazard: a token that is not unique per batch silently loses
    // events.
    await insert(table, batch("third"), arm.insert);
    const afterSameTokenNewData = await count(table);

    await exec(`DROP TABLE ${table}`);

    return {
        arm: arm.name,
        expectation: arm.expectation,
        afterRetry,
        afterNewToken,
        afterSameTokenNewData,
        deduplicates: afterRetry === 2,
        newTokenAccepted: afterNewToken === afterRetry + 2,
        sameTokenNewDataDropped: afterSameTokenNewData === afterNewToken,
    };
}

/**
 * Does the 100-insert window actually hold a retry? 120 distinct tokens are
 * inserted between the original and its retry, so the original has fallen out
 * of a window of 100.
 */
async function probeWindowOverflow() {
    const table = "probe_dedup_window";
    await createTable(table, "SETTINGS non_replicated_deduplication_window = 100");

    const settings = { async_insert: 1, wait_for_async_insert: 1 };
    await insert(table, batch("origin"), { ...settings, insert_deduplication_token: "origin" });
    for (let i = 0; i < 120; i++) {
        await insert(table, batch(`filler-${i}`), {
            ...settings,
            insert_deduplication_token: `filler-${i}`,
        });
    }
    const before = await count(table);
    await insert(table, batch("origin"), { ...settings, insert_deduplication_token: "origin" });
    const after = await count(table);
    await exec(`DROP TABLE ${table}`);

    return { before, after, stillDeduplicated: before === after };
}

/** Is the token scoped per partition, as the setting's own docs claim? */
async function probePartitionScope() {
    const table = "probe_dedup_partitions";
    await createTable(table, "SETTINGS non_replicated_deduplication_window = 100");

    const settings = { async_insert: 1, wait_for_async_insert: 1, insert_deduplication_token: "cross" };
    const august = JSON.stringify({ id: 1, ts: "2026-08-26 10:00:00", marker: "aug" });
    const september = JSON.stringify({ id: 1, ts: "2026-09-02 10:00:00", marker: "sep" });

    await insert(table, august, settings);
    await insert(table, september, settings);
    const afterBothMonths = await count(table);
    await insert(table, september, settings);
    const afterSeptemberRetry = await count(table);
    await exec(`DROP TABLE ${table}`);

    return {
        afterBothMonths,
        afterSeptemberRetry,
        perPartition: afterBothMonths === 2,
        retryStillDeduplicated: afterSeptemberRetry === afterBothMonths,
    };
}

async function main() {
    await ping();
    const version = await one("SELECT version() AS v");
    console.log(`ClickHouse ${version.v}\n`);

    const results = [];
    for (const [index, arm] of ARMS.entries()) {
        results.push(await runArm(arm, index));
    }

    console.log("Same batch twice with the same token (2 rows per insert):\n");
    for (const r of results) {
        console.log(`  ${r.arm}`);
        console.log(`    rows after the retry       ${r.afterRetry}  -> ${r.deduplicates ? "DEDUPLICATED" : "duplicated"}`);
        console.log(`    a new token is accepted    ${r.newTokenAccepted ? "yes" : "NO — events would be lost"}`);
        console.log(`    same token, different data ${r.sameTokenNewDataDropped ? "DROPPED — the token wins over the checksum" : "inserted"}`);
        console.log(`    expected: ${r.expectation}\n`);
    }

    const overflow = await probeWindowOverflow();
    console.log(`Window overflow — 120 distinct tokens between an insert and its retry:`);
    console.log(`  ${overflow.before} rows before, ${overflow.after} after -> ${overflow.stillDeduplicated ? "still deduplicated" : "NOT deduplicated, the retry fell out of the window"}\n`);

    const partitions = await probePartitionScope();
    console.log(`Partition scope — one token, two months:`);
    console.log(`  both months inserted: ${partitions.perPartition ? "yes — the token is per partition" : "no"}`);
    console.log(`  September's retry deduplicated: ${partitions.retryStillDeduplicated ? "yes" : "no"}\n`);

    console.log(JSON.stringify({ version: version.v, arms: results, overflow, partitions }, null, 2));
}

main().catch((err) => {
    console.error(err.message);
    process.exit(1);
});
