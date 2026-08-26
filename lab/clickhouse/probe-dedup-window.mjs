/**
 * Experiment 6, part two — how large must `non_replicated_deduplication_window`
 * be, and what does the size cost?
 *
 * `probe-dedup.mjs` established the semantics: the token deduplicates a retry
 * under `async_insert` exactly as it does under a sync insert, but only if the
 * table carries `non_replicated_deduplication_window`, and the window is a
 * count of the **last N inserts per partition** with no time dimension — the
 * `_seconds` and `_for_async_inserts` variants exist only for Replicated
 * tables. At 100 a retry 120 inserts later was already through.
 *
 * So the size is a design input, and it is a rate question: the window has to
 * outlast the gap between an insert and the SDK's retry of it.
 *
 * Run against the dev ClickHouse (docker-compose.dev.yml):
 *     node lab/clickhouse/probe-dedup-window.mjs
 */

import { exec, one, ping } from "./ch.mjs";

const WINDOWS = [100, 1000, 10000];
const SETTINGS = { async_insert: 1, wait_for_async_insert: 1 };

function row(marker) {
    return JSON.stringify({ id: 1, ts: "2026-08-26 10:00:00", marker });
}

async function probe(window) {
    const table = `probe_win_${window}`;
    await exec(`DROP TABLE IF EXISTS ${table}`);
    await exec(`
        CREATE TABLE ${table} (id UInt32, ts DateTime, marker String)
        ENGINE = MergeTree PARTITION BY toYYYYMM(ts) ORDER BY (id, ts)
        SETTINGS non_replicated_deduplication_window = ${window}
    `);

    // The insert whose retry we are going to test, then `window - 1` others, so
    // it is the oldest entry still inside the window.
    const started = Date.now();
    await exec(`INSERT INTO ${table} FORMAT JSONEachRow\n${row("origin")}`, {
        settings: { ...SETTINGS, insert_deduplication_token: "origin" },
    });
    for (let i = 0; i < window - 1; i++) {
        await exec(`INSERT INTO ${table} FORMAT JSONEachRow\n${row(`f${i}`)}`, {
            settings: { ...SETTINGS, insert_deduplication_token: `f${i}` },
        });
    }
    const elapsedMs = Date.now() - started;

    const atEdge = Number((await one(`SELECT count() AS n FROM ${table}`)).n);
    await exec(`INSERT INTO ${table} FORMAT JSONEachRow\n${row("origin")}`, {
        settings: { ...SETTINGS, insert_deduplication_token: "origin" },
    });
    const afterEdgeRetry = Number((await one(`SELECT count() AS n FROM ${table}`)).n);

    // One more filler pushes the original out, then retry again.
    await exec(`INSERT INTO ${table} FORMAT JSONEachRow\n${row("push")}`, {
        settings: { ...SETTINGS, insert_deduplication_token: "push" },
    });
    const afterPush = Number((await one(`SELECT count() AS n FROM ${table}`)).n);
    await exec(`INSERT INTO ${table} FORMAT JSONEachRow\n${row("origin")}`, {
        settings: { ...SETTINGS, insert_deduplication_token: "origin" },
    });
    const afterPushRetry = Number((await one(`SELECT count() AS n FROM ${table}`)).n);

    const parts = await one(`
        SELECT count() AS parts, sum(rows) AS rows
        FROM system.parts WHERE table = '${table}' AND active
    `);

    return {
        window,
        insertsPerSecond: Math.round((window / elapsedMs) * 1000),
        heldAtEdge: afterEdgeRetry === atEdge,
        heldAfterPush: afterPushRetry === afterPush,
        parts: Number(parts.parts),
    };
}

async function diskCost(window) {
    const table = `probe_win_${window}`;
    const { execSync } = await import("node:child_process");
    try {
        const out = execSync(
            `docker compose -f docker-compose.dev.yml exec -T clickhouse ` +
                `sh -c "du -sh /var/lib/clickhouse/data/logger/${table} 2>/dev/null; ` +
                `find /var/lib/clickhouse/data/logger/${table} -name 'deduplication*' -o -name '*dedup*' 2>/dev/null | head -5"`,
            { encoding: "utf8" },
        );
        return out.trim();
    } catch {
        return "(du unavailable)";
    }
}

async function main() {
    await ping();
    console.log(`ClickHouse ${(await one("SELECT version() AS v")).v}\n`);

    const results = [];
    for (const window of WINDOWS) {
        const r = await probe(window);
        r.disk = await diskCost(window);
        results.push(r);
        console.log(
            `window=${String(window).padStart(5)}  ` +
                `${String(r.insertsPerSecond).padStart(4)} inserts/s  ` +
                `retry at the window edge: ${r.heldAtEdge ? "deduplicated" : "MISSED"}  ` +
                `one insert past it: ${r.heldAfterPush ? "deduplicated" : "missed (expected)"}  ` +
                `parts: ${r.parts}`,
        );
        console.log(`  on disk: ${r.disk.replace(/\n/g, "\n           ")}`);
        await exec(`DROP TABLE probe_win_${window}`);
    }

    console.log(`\n${JSON.stringify(results, null, 2)}`);
}

main().catch((err) => {
    console.error(err.message);
    process.exit(1);
});
