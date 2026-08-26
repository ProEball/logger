/**
 * One-off probe: what drives the memory cost of a wide `JSON` column — the
 * **number of distinct paths** in the table, or the **width** of the data in
 * each row?
 *
 *   node lab/clickhouse/probe-json-memory.mjs
 *
 * §14.3.1 recorded that a bulk `INSERT … SELECT` exceeded the 3 GiB ceiling at
 * 18 attributes per project where it succeeded at 3, and could not say why.
 * `max_dynamic_paths` is 2048 and only 180 paths existed, so the documented
 * ceiling was not the constraint. The answer decides whether an install with a
 * hundred projects behaves like the lab or much worse — a path budget is shared
 * across all projects, a width budget is not.
 *
 * **The design holds one factor still while moving the other.** Every arm
 * writes the same number of rows with the same number of keys per row; only
 * the number of distinct key *names* across the table changes, or only the
 * length of the values does. Anything else measured would confound the two —
 * which is exactly what the first observation did, since going from 3 to 18
 * attributes raised paths and width together.
 *
 *   p18    18 paths,   18 keys/row, short values   ← baseline
 *   p180   180 paths,  18 keys/row, short values   ← the lab's current shape
 *   p1800  1800 paths, 18 keys/row, short values   ← 100 projects' worth
 *   w10    18 paths,   18 keys/row, 10x values     ← width alone
 *
 * p18 → p180 → p1800 isolates paths. p18 → w10 isolates width.
 *
 * Deleted with the rest of `lab/` once §14.3.1 is closed.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { exec, one, ping } from "./ch.mjs";

// `fileURLToPath`, not `new URL(...).pathname` — on Windows the latter yields
// `/D:/…`, which every fs call then rejects.
const OUT = fileURLToPath(new URL("./out/", import.meta.url));

/** Each arm writes its own file, so a restart between arms loses nothing. */
function writeResult(name, result) {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(`${OUT}/probe-${name}.json`, JSON.stringify(result, null, 2), "utf8");
}

const ROWS = 500_000;
const KEYS_PER_ROW = 18;
const BATCH = 25_000;

const ARMS = [
    { name: "p18", pathPool: 18, valueLen: 12 },
    { name: "p180", pathPool: 180, valueLen: 12 },
    { name: "p1800", pathPool: 1800, valueLen: 12 },
    { name: "w10", pathPool: 18, valueLen: 120 },
    // Added after the first clean run put the ingest ceiling somewhere between
    // 180 paths (fine) and 1800 (cannot load at all). "Somewhere between" is
    // not something a schema decision can be made against.
    { name: "p360", pathPool: 360, valueLen: 12 },
    { name: "p720", pathPool: 720, valueLen: 12 },
];

function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Row `i` draws its 18 keys from a contiguous window of the pool, so a pool of
 * 1800 really does put 1800 distinct paths in the table rather than 18 popular
 * ones and a long tail — the tail would be a third variable.
 */
function buildRow(i, pathPool, valueLen, random) {
    const attributes = {};
    const base = (Math.floor(i / 1000) * KEYS_PER_ROW) % pathPool;
    for (let k = 0; k < KEYS_PER_ROW; k++) {
        attributes[`k${(base + k) % pathPool}`] = "v".repeat(valueLen - 6) + Math.floor(random() * 1e6);
    }
    return JSON.stringify({
        id: i,
        // `slice(0, 19)` drops the milliseconds: the column is `DateTime`, not
        // `DateTime64`, and a trailing `.000` is a parse error, not a rounding.
        ts: new Date(Date.UTC(2026, 7, 1) + i * 100).toISOString().replace("T", " ").slice(0, 19),
        attributes,
    });
}

const ddl = (name) => `
CREATE TABLE ${name} (
    id UInt64,
    ts DateTime,
    attributes JSON(max_dynamic_paths = 8192)
) ENGINE = MergeTree ORDER BY id`;

/** Peak memory and bytes for one statement, read back out of query_log. */
async function costOf(sql, settings = {}) {
    const queryId = `probe-${Math.random().toString(36).slice(2)}`;
    try {
        await exec(sql, { settings: { ...settings, query_id: queryId } });
    } catch (err) {
        return { failed: err.message.replace(/\s+/g, " ").slice(0, 90) };
    }
    await exec("SYSTEM FLUSH LOGS");
    return one(
        `SELECT memory_usage, read_bytes, written_bytes, query_duration_ms
         FROM system.query_log WHERE query_id = {q:String} AND type = 'QueryFinish' LIMIT 1`,
        { params: { q: queryId } },
    );
}

const mib = (b) => (Number(b) / 1024 / 1024).toFixed(1);

/**
 * One arm per invocation, with the container restarted between them.
 *
 * The first attempt ran all four in one process and the third failed reporting
 * `current RSS: 3.00 GiB` — the ceiling was already occupied by what the
 * previous arms had left resident, so each arm was being measured under its
 * predecessor's residue and the comparison was worthless. `DROP TABLE` frees
 * the data, not the caches and in-flight merges. A restart is the only way to
 * give every arm the same empty budget.
 */
async function main() {
    await ping();
    const wanted = process.argv.includes("--arm")
        ? process.argv[process.argv.indexOf("--arm") + 1]
        : null;
    const selected = wanted ? ARMS.filter((a) => a.name === wanted) : ARMS;
    if (!selected.length) throw new Error(`unknown arm "${wanted}" — try ${ARMS.map((a) => a.name).join(", ")}`);

    // The 5M-row tables would compete for the same budget and make every
    // reading a statement about what else was resident.
    for (const t of ["events_a", "events_b"]) await exec(`DROP TABLE IF EXISTS ${t}`);

    const results = [];

    for (const arm of selected) {
        const src = `probe_${arm.name}`;
        const dst = `probe_${arm.name}_copy`;
        for (const t of [src, dst]) await exec(`DROP TABLE IF EXISTS ${t}`);
        await exec(ddl(src));
        await exec(ddl(dst));

        const random = mulberry32(42);
        let buffer = [];
        const flush = async () => {
            if (!buffer.length) return;
            await exec(`INSERT INTO ${src} FORMAT JSONEachRow\n${buffer.join("\n")}`, {
                settings: { async_insert: 1, wait_for_async_insert: 1 },
            });
            buffer = [];
        };
        // A load that dies is a result, not a crash: "this shape cannot even be
        // written at this budget" is the strongest form the finding can take,
        // and aborting here would lose the arms after it.
        const loadStart = Date.now();
        let loadFailed = null;
        try {
            for (let i = 0; i < ROWS; i++) {
                buffer.push(buildRow(i, arm.pathPool, arm.valueLen, random));
                if (buffer.length >= BATCH) await flush();
            }
            await flush();
        } catch (err) {
            loadFailed = err.message.replace(/\s+/g, " ").slice(0, 90);
        }
        const loadSecs = (Date.now() - loadStart) / 1000;
        if (loadFailed) {
            results.push({ arm: arm.name, paths: arm.pathPool, "COPY peak MiB": "LOAD FAILED" });
            console.log(`  ${arm.name.padEnd(6)} LOAD FAILED after ${loadSecs.toFixed(0)}s`);
            console.log(`         ${loadFailed}`);
            writeResult(arm.name, { arm: arm.name, paths: arm.pathPool, loadFailed });
            continue;
        }

        const size = await one(
            `SELECT sum(bytes_on_disk) AS disk,
                    sum(data_uncompressed_bytes) AS raw
             FROM system.parts WHERE table = {t:String} AND active`,
            { params: { t: src } },
        );
        // Guarded, and the guard is itself a finding: at 360 paths this
        // introspection query — not the copy — was what exceeded 3 GiB.
        // `JSONAllPaths` materialises every path for every row, so asking "what
        // paths exist" costs far more than reading one of them. An unguarded
        // call killed the p360 arm and produced no result at all.
        const paths = await one(`SELECT uniqExact(arrayJoin(JSONAllPaths(attributes))) AS n FROM ${src}`)
            .catch(() => ({ n: `${arm.pathPool} (introspection OOM)` }));

        // The operation that failed in §14.3.1: one bulk copy, no chunking.
        const copy = await costOf(`INSERT INTO ${dst} SELECT * FROM ${src}`, {
            max_threads: 2,
            max_insert_threads: 1,
            max_block_size: 32768,
        });
        // A read of one path, for contrast — §14.3.1 observed reads stay cheap.
        const read = await costOf(`SELECT uniqExact(attributes.k0.:String) FROM ${src}`, {
            max_threads: 2,
        });

        results.push({
            arm: arm.name,
            paths: Number(paths.n),
            "raw MiB": mib(size.raw),
            "disk MiB": mib(size.disk),
            "load rows/s": Math.round(ROWS / loadSecs).toLocaleString("en-US"),
            "COPY peak MiB": copy.failed ? `FAILED` : mib(copy.memory_usage),
            "COPY ms": copy.failed ? "—" : copy.query_duration_ms,
            "READ peak MiB": read.failed ? "FAILED" : mib(read.memory_usage),
        });
        writeResult(arm.name, results.at(-1));
        console.log(`  ${arm.name.padEnd(6)} done  (${results.at(-1)["COPY peak MiB"]} MiB peak on copy)`);
        if (copy.failed) console.log(`         ${copy.failed}`);

        for (const t of [src, dst]) await exec(`DROP TABLE IF EXISTS ${t}`);
    }

    console.log(`\n${ROWS.toLocaleString("en-US")} rows/arm, ${KEYS_PER_ROW} keys per row in every arm\n`);
    console.table(results);

    const byName = Object.fromEntries(results.map((r) => [r.arm, r]));
    const ratio = (a, b) => (Number(byName[b]["COPY peak MiB"]) / Number(byName[a]["COPY peak MiB"])).toFixed(2);
    console.log(`
paths  x10  (p18 → p180):   ${ratio("p18", "p180")}x peak memory
paths  x100 (p18 → p1800):  ${ratio("p18", "p1800")}x
width  x10  (p18 → w10):    ${ratio("p18", "w10")}x

If the path ratios move and the width ratio does not, the constraint is per-path
overhead and it is shared across every project in the install — a hundred
projects would hit it where ten do not. If width moves it instead, the cost
tracks the data and scales the way any other column would.`);
}

main().catch((err) => {
    console.error(`\n${err.message}`);
    process.exit(1);
});
