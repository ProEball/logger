/**
 * The Phase 0 experiments from `docs/features/09-clickhouse.md` §13.
 *
 *   node lab/clickhouse/measure.mjs [--projection]
 *
 * **Read `read_rows`, not `ms`.** Durations on a laptop measure the laptop —
 * page cache, thermal state, whatever else is running. Rows and bytes read are
 * properties of the sort key and the skip indexes, and they transfer to the
 * production host. The `ms` column is printed because it is free, not because
 * it settles anything. This is the same caution `widgets.md` records about the
 * 222/1699/2218/437 ms spread that turned out to be measuring CPU contention.
 *
 * Every EXPLAIN goes to `lab/clickhouse/out/` for reading, because "granules
 * selected" is the number that actually explains a row count.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { exec, rows, one, ping } from "./ch.mjs";
import { CANDIDATES, addProjection, materializeProjection } from "./schema.mjs";
import { PROJECT_ATTRIBUTES, projectId } from "./corpus.mjs";

const OUT_DIR = new URL("./out/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const TABLES = Object.keys(CANDIDATES);
const fmt = (n) => Number(n).toLocaleString("en-US");

/**
 * Every experiment is a function of the table name, so the two candidates are
 * guaranteed to run the identical query. `label` names the plan's query pattern.
 */
function experiments({ project, traceId, eventId, eventTs, attrKey, attrChType, busySource }) {
    /**
     * A JSON path reads back as `Dynamic`, and ClickHouse refuses `Dynamic` in
     * a GROUP BY key outright:
     *
     *   Code 44: Data types Variant/Dynamic are not allowed in GROUP BY keys,
     *   because it can lead to unexpected results.
     *
     * Its own advice is to use a typed subcolumn — `json.path.:String`. So a
     * custom widget grouping by an attribute **must know that attribute's
     * type**, which is precisely what `attribute_key_types` records. Found
     * 2026-08-26 while smoke-testing this lab; see plan §4.3.
     *
     * Q4-json uses the typed accessor, Q4-dyn the cast you would write without
     * a registry. Measuring both is what turns "the registry is useful" into a
     * number.
     */
    const typed = `attributes.${attrKey}.:${attrChType}`;
    const RANGE = "timestamp >= now() - INTERVAL 7 DAY";
    return [
        {
            id: "Q1-plain",
            label: "events list, no filter (dominant)",
            sql: (t) => `
                SELECT timestamp, id, level, message FROM ${t}
                WHERE project_id = {project:UUID} AND ${RANGE}
                ORDER BY timestamp DESC, id DESC LIMIT 51`,
        },
        {
            id: "Q1-level",
            label: "events list, level >= error",
            sql: (t) => `
                SELECT timestamp, id, level, message FROM ${t}
                WHERE project_id = {project:UUID} AND ${RANGE} AND level >= 'error'
                ORDER BY timestamp DESC, id DESC LIMIT 51`,
        },
        {
            id: "Q1-attr",
            label: "events list, attribute filter",
            sql: (t) => `
                SELECT timestamp, id, level, message FROM ${t}
                WHERE project_id = {project:UUID} AND ${RANGE}
                  AND attributes.${attrKey} IS NOT NULL
                ORDER BY timestamp DESC, id DESC LIMIT 51`,
        },
        {
            id: "Q1-msg",
            label: "events list, full-text (tokenbf)",
            sql: (t) => `
                SELECT timestamp, id, level, message FROM ${t}
                WHERE project_id = {project:UUID} AND ${RANGE}
                  AND hasToken(message_lower, 'authorized')
                ORDER BY timestamp DESC, id DESC LIMIT 51`,
        },
        {
            id: "Q2-buckets",
            label: "dashboard chart, 7d by minute",
            sql: (t) => `
                SELECT toStartOfMinute(timestamp) AS m, level, count() AS n FROM ${t}
                WHERE project_id = {project:UUID} AND ${RANGE}
                GROUP BY m, level ORDER BY m`,
        },
        {
            id: "Q3-facet",
            label: "facet counts on source",
            sql: (t) => `
                SELECT source, count() AS n FROM ${t}
                WHERE project_id = {project:UUID} AND ${RANGE}
                GROUP BY source ORDER BY n DESC LIMIT 20`,
        },
        {
            id: "Q4-json",
            label: `custom widget, typed subcolumn: ${typed}`,
            sql: (t) => `
                SELECT ${typed} AS k, count() AS n FROM ${t}
                WHERE project_id = {project:UUID} AND ${RANGE}
                GROUP BY k ORDER BY n DESC LIMIT 20`,
        },
        {
            id: "Q4-dyn",
            label: `same widget without the type registry: toString(...)`,
            sql: (t) => `
                SELECT toString(attributes.${attrKey}) AS k, count() AS n FROM ${t}
                WHERE project_id = {project:UUID} AND ${RANGE}
                GROUP BY k ORDER BY n DESC LIMIT 20`,
        },
        {
            id: "Q4-map",
            label: `same widget on Map: attr_str['${attrKey}']`,
            sql: (t) => `
                SELECT attr_str[{attrKey:String}] AS k, count() AS n FROM ${t}
                WHERE project_id = {project:UUID} AND ${RANGE}
                GROUP BY k ORDER BY n DESC LIMIT 20`,
        },
        {
            id: "Q4-org",
            label: "tier-2 worst case: org-wide 30d group by attribute",
            sql: (t) => `
                SELECT ${typed} AS k, count() AS n FROM ${t}
                WHERE timestamp >= now() - INTERVAL 30 DAY
                GROUP BY k ORDER BY n DESC LIMIT 20`,
        },
        {
            id: "Q4-conj",
            label: "tier-1 miss: filter on source + release together",
            sql: (t) => `
                SELECT toStartOfHour(timestamp) AS h, count() AS n FROM ${t}
                WHERE project_id = {project:UUID} AND ${RANGE}
                  AND source = {busySource:String}
                GROUP BY h ORDER BY h`,
        },
        {
            id: "Q5-trace",
            label: "TIMELINE — trace lookup, no time bound",
            sql: (t) => `
                SELECT timestamp, id, level, message FROM ${t}
                WHERE project_id = {project:UUID} AND trace_id = {traceId:String}
                ORDER BY timestamp`,
        },
        {
            id: "Q6-alert",
            label: "alert evaluation, trailing 10 minutes",
            sql: (t) => `
                SELECT count() FROM ${t}
                WHERE project_id = {project:UUID}
                  AND timestamp >= now() - INTERVAL 10 MINUTE
                  AND level >= 'error' AND environment = 'production'`,
        },
        {
            id: "Q7-point",
            label: "drawer: one event by primary key",
            sql: (t) => `
                SELECT * EXCEPT (attributes) FROM ${t}
                WHERE project_id = {project:UUID}
                  AND timestamp = {eventTs:DateTime64(3)} AND id = {eventId:UUID}`,
        },
    ].map((e) => ({
        ...e,
        params: { project, traceId, eventId, eventTs, attrKey, busySource },
    }));
}

/** Run one query, then read what it actually cost out of `system.query_log`. */
async function measure(sql, params) {
    const queryId = `lab-${Math.random().toString(36).slice(2)}`;
    await exec("SYSTEM DROP MARK CACHE");
    await exec(sql, { params, settings: { query_id: queryId } });
    await exec("SYSTEM FLUSH LOGS");
    const row = await one(
        `SELECT read_rows, read_bytes, result_rows, query_duration_ms, memory_usage
         FROM system.query_log
         WHERE query_id = {qid:String} AND type = 'QueryFinish'
         ORDER BY event_time DESC LIMIT 1`,
        { params: { qid: queryId } },
    );
    if (!row) throw new Error("query_log had no QueryFinish row — is the log table enabled?");
    return row;
}

async function sampleTargets() {
    const busiest = await one(
        `SELECT project_id, count() AS n FROM events_a GROUP BY project_id ORDER BY n DESC LIMIT 1`,
    );
    const project = busiest.project_id;

    // Map the id back to its corpus index so the attribute key belongs to this
    // project. A key from a different project would make Q4 measure an empty
    // group-by and report it as fast.
    const index = PROJECT_ATTRIBUTES.findIndex((_, i) => projectId(i) === project);
    if (index < 0) throw new Error(`project ${project} is not one this corpus generated`);
    const [attrKey, attrType] = Object.entries(PROJECT_ATTRIBUTES[index]).find(([, t]) => t === "string");
    // The registry's type label → the ClickHouse type of the JSON subcolumn.
    // Without this mapping there is no typed accessor and no Q4-json at all.
    const attrChType = { string: "String", number: "Float64", boolean: "Bool" }[attrType];

    const sample = await one(`
        SELECT trace_id, id, toString(timestamp) AS ts, source
        FROM events_a
        WHERE project_id = {project:UUID} AND timestamp >= now() - INTERVAL 7 DAY
        LIMIT 1`, { params: { project } });
    if (!sample) throw new Error("no rows in the last 7 days — was the corpus seeded with --days < 7?");

    return {
        project,
        projectShare: Number(busiest.n),
        attrKey,
        attrChType,
        traceId: sample.trace_id,
        eventId: sample.id,
        eventTs: sample.ts,
        busySource: sample.source,
    };
}

async function facts() {
    console.log("\n── facts ──────────────────────────────────────────────────────\n");

    const perColumn = await rows(`
        SELECT column,
               formatReadableSize(sum(column_data_compressed_bytes))   AS compressed,
               formatReadableSize(sum(column_data_uncompressed_bytes)) AS raw,
               round(sum(column_data_uncompressed_bytes) / nullIf(sum(column_data_compressed_bytes), 0), 1) AS ratio
        FROM system.parts_columns
        WHERE table = 'events_a' AND active
        GROUP BY column
        ORDER BY sum(column_data_compressed_bytes) DESC`);
    console.log("compression, events_a — experiment 3 (the 220 GB estimate in §1.1 rests on this)");
    console.table(perColumn);

    const total = await one(`
        SELECT count() AS rows,
               formatReadableSize(sum(bytes_on_disk)) AS on_disk,
               round(sum(bytes_on_disk) / (SELECT count() FROM events_a), 1) AS bytes_per_row,
               uniqExact(partition) AS partitions,
               count() AS parts
        FROM system.parts WHERE table = 'events_a' AND active`);
    console.log(`on disk ${total.on_disk} · ${total.bytes_per_row} bytes/row · ${total.partitions} partitions · ${total.parts} parts`);
    console.log(`  → a year at 10M/day projects to ~${((Number(total.bytes_per_row) * 3.65e9) / 1e12).toFixed(2)} TB`);

    const templates = await one(`
        SELECT round(avg(n), 0) AS mean_per_hour, max(n) AS max_per_hour
        FROM (
            SELECT toStartOfHour(timestamp) AS h, project_id, uniqExact(template_hash) AS n
            FROM events_a GROUP BY h, project_id
        )`);
    console.log(`\ndistinct templates per project-hour — experiment 5: mean ${templates.mean_per_hour}, max ${templates.max_per_hour}`);
    console.log(`  → events_by_template ≈ ${fmt(Number(templates.mean_per_hour) * 24 * 10)} rows/day at 10 projects`);

    const paths = await rows(`
        SELECT arrayJoin(JSONAllPathsWithTypes(attributes)) AS path
        FROM events_a LIMIT 5000`).catch((err) => {
        console.log(`\nJSON path introspection unavailable: ${err.message.slice(0, 120)}`);
        return [];
    });
    if (paths.length) {
        const distinct = new Set(paths.map((p) => JSON.stringify(p.path)));
        console.log(`\nJSON dynamic paths seen in a 5k sample — experiment 2: ${distinct.size} (budget 2048)`);
    }

    const ua = await one(`SELECT uniqExact(user_agent) AS n FROM events_a`);
    console.log(`\nuniq(user_agent) = ${ua.n} — experiment 4 needs REAL traffic; this corpus has ${ua.n} by construction`);
}

async function main() {
    const withProjection = process.argv.includes("--projection");
    mkdirSync(OUT_DIR, { recursive: true });
    await ping();

    const targets = await sampleTargets();
    console.log(`busiest project ${targets.project} (${fmt(targets.projectShare)} rows)`);
    console.log(`attribute key "${targets.attrKey}" (${targets.attrChType}) · trace ${targets.traceId}\n`);

    if (withProjection) {
        for (const t of TABLES) {
            console.log(`materializing p_minute on ${t} …`);
            await exec(addProjection(t));
            await exec(materializeProjection(t));
        }
        console.log("");
    }

    const list = experiments(targets);
    const explains = [];
    const results = [];

    for (const e of list) {
        const row = { experiment: e.id, what: e.label };
        for (const t of TABLES) {
            const sql = e.sql(t);
            try {
                explains.push(
                    `${"=".repeat(70)}\n${e.id} — ${t}\n${sql}\n${"-".repeat(70)}\n` +
                        (await exec(`EXPLAIN indexes = 1 ${sql}`, { params: e.params })),
                );
                const m = await measure(sql, e.params);
                row[`${t} rows`] = fmt(m.read_rows);
                row[`${t} MB`] = (Number(m.read_bytes) / 1e6).toFixed(1);
                row[`${t} ms`] = m.query_duration_ms;
            } catch (err) {
                // Long enough to carry ClickHouse's own advice — its errors
                // name the fix, and truncating at 60 threw that away once.
                row[`${t} rows`] = `ERR ${err.message.replace(/\s+/g, " ").slice(0, 140)}`;
            }
        }
        results.push(row);
        console.log(`  ${e.id.padEnd(11)} done`);
    }

    console.log(`\n── read_rows is the number that transfers; ms measures this machine ──\n`);
    console.table(results);

    const suffix = withProjection ? "-projection" : "";
    writeFileSync(`${OUT_DIR}/explain${suffix}.txt`, explains.join("\n\n"), "utf8");
    writeFileSync(`${OUT_DIR}/results${suffix}.json`, JSON.stringify({ targets, results }, null, 2), "utf8");
    console.log(`EXPLAIN plans → lab/clickhouse/out/explain${suffix}.txt`);

    await facts();

    console.log(`
── how to read this ───────────────────────────────────────────────
Q1-plain      events_a should read ~51 rows. If events_b reads far
              more, the level-in-key candidate loses on the dominant
              pattern and §3.2 stands.
Q1-level      the only place events_b should win. Weigh the size of
              its win against the size of its loss on Q1-plain.
Q4-json/dyn/map
              experiment 2, three ways. json = typed subcolumn,
              dyn = the same query without knowing the type, map =
              the fallback design.

              !! Compare the MB column here, not rows. All three
              touch the same granules, so read_rows is identical by
              construction and equal row counts say nothing. The
              claim under test — that a JSON subcolumn is read on
              its own while a Map drags every key and value with it
              — is a claim about BYTES.

              If json does not beat map clearly on MB, the fallback
              costs nothing and §4.3 should take it. json vs dyn is
              what the type registry buys.
Q5-trace      expected to be bad on BOTH — that is the finding that
              justifies events_by_correlation (§7), not a defect.
Q4-org        the tier-2 worst case. This number decides whether
              org-scoped custom widgets get a range cap (§6.2).
`);
}

main().catch((err) => {
    console.error(`\n${err.message}`);
    process.exit(1);
});
