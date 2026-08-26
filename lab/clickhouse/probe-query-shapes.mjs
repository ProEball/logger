/**
 * Phase 3 — the query shapes the filter compiler has to emit.
 *
 * The compiler is a pure function and will be unit-tested against the SQL it
 * produces, which proves the *string* and nothing about whether ClickHouse
 * accepts it. Phase 2 already paid for that gap once: three row-shape
 * assumptions were wrong and every one of them failed at the wire and nowhere
 * else (§12.2). So the shapes are settled here, against a real server, before
 * the compiler is written rather than after.
 *
 * Each probe prints what it asked and what came back. Read the answers, not a
 * pass/fail — several of these have no "right" answer, only a behaviour the
 * compiler then has to be built around.
 *
 *     node lab/clickhouse/probe-query-shapes.mjs
 */

import { exec, rows, one, ping, insertJsonEachRow } from "./ch.mjs";

const TABLE = "probe_query_shapes";

const FIXTURE = [
    {
        project_id: "11111111-1111-4111-8111-111111111111",
        timestamp: "2026-08-26 10:00:00.000",
        id: "01920000-0000-7000-8000-000000000001",
        level: "info",
        message: "Connection refused by upstream",
        source: "api",
        environment: "production",
        attributes: { order_id: "o_1", retries: 2, ok: true },
        user_id: "u_1",
    },
    {
        project_id: "11111111-1111-4111-8111-111111111111",
        timestamp: "2026-08-26 10:00:01.000",
        id: "01920000-0000-7000-8000-000000000002",
        level: "error",
        message: "Timeout after 30s",
        source: "worker",
        environment: "",
        attributes: { order_id: "o_2" },
        user_id: "",
    },
    {
        project_id: "11111111-1111-4111-8111-111111111111",
        timestamp: "2026-08-26 10:00:02.000",
        id: "01920000-0000-7000-8000-000000000003",
        level: "debug",
        message: "debug noise",
        source: "",
        environment: "staging",
        attributes: {},
        user_id: "",
    },
];

const PROJECT = FIXTURE[0].project_id;

async function setup() {
    await exec(`DROP TABLE IF EXISTS ${TABLE}`);
    await exec(`
        CREATE TABLE ${TABLE}
        (
            project_id    UUID,
            timestamp     DateTime64(3, 'UTC'),
            id            UUID,
            level         Enum8('debug' = 1, 'info' = 2, 'warn' = 3, 'error' = 4, 'fatal' = 5),
            message       String,
            message_lower String MATERIALIZED lowerUTF8(message),
            source        LowCardinality(String),
            environment   LowCardinality(String),
            user_id       String,
            attributes    JSON(max_dynamic_paths = 2048),
            INDEX idx_msg message_lower TYPE tokenbf_v1(32768, 3, 0) GRANULARITY 4
        )
        ENGINE = MergeTree ORDER BY (project_id, timestamp, id)
    `);
    await insertJsonEachRow(TABLE, FIXTURE.map((r) => JSON.stringify(r)).join("\n"));
}

async function probe(label, sql, params) {
    const flat = sql.trim().replace(/\s+/g, " ");
    try {
        const result = await rows(sql, { params });
        console.log(`\n  ${label}\n    ${flat}\n    => ${JSON.stringify(result)}`);
        return result;
    } catch (err) {
        console.log(`\n  ${label}\n    ${flat}\n    XX ${err.message.split("\n")[0]}`);
        return null;
    }
}

async function main() {
    await ping();
    await setup();

    console.log("\n1. Attribute path from a *parameter* — the key is user input and cannot be interpolated");
    await probe(
        "getSubcolumn with a bound key",
        `SELECT message FROM ${TABLE} WHERE getSubcolumn(attributes, {key:String}) = {val:String} ORDER BY id`,
        { key: "order_id", val: "o_1" },
    );
    await probe(
        "getSubcolumn, value compared as text",
        `SELECT message FROM ${TABLE} WHERE toString(getSubcolumn(attributes, {key:String})) = {val:String} ORDER BY id`,
        { key: "retries", val: "2" },
    );
    await probe(
        "getSubcolumn on a path no row has",
        `SELECT count() AS n FROM ${TABLE} WHERE toString(getSubcolumn(attributes, {key:String})) = {val:String}`,
        { key: "nope", val: "x" },
    );
    await probe(
        "what a missing path actually returns",
        `SELECT id, toString(getSubcolumn(attributes, 'nope')) AS v, toTypeName(getSubcolumn(attributes, 'nope')) AS t FROM ${TABLE} ORDER BY id LIMIT 1`,
    );
    await probe(
        "static path syntax, for comparison",
        `SELECT message FROM ${TABLE} WHERE attributes.order_id = {val:String} ORDER BY id`,
        { val: "o_1" },
    );
    await probe(
        "a key with a dot in it, via getSubcolumn",
        `SELECT count() AS n FROM ${TABLE} WHERE toString(getSubcolumn(attributes, {key:String})) = {val:String}`,
        { key: "a.b", val: "x" },
    );

    console.log("\n2. Enum8 against a bound array of strings");
    await probe(
        "level IN Array(String)",
        `SELECT message FROM ${TABLE} WHERE level IN {levels:Array(String)} ORDER BY id`,
        { levels: "['info','error']" },
    );
    await probe(
        "level IN Array(String) via has()",
        `SELECT message FROM ${TABLE} WHERE has({levels:Array(String)}, toString(level)) ORDER BY id`,
        { levels: "['info','error']" },
    );
    await probe(
        "an unknown level in the array",
        `SELECT count() AS n FROM ${TABLE} WHERE level IN {levels:Array(String)}`,
        { levels: "['nonsense']" },
    );

    console.log("\n3. LowCardinality(String) against a bound array");
    await probe(
        "source IN Array(String)",
        `SELECT message FROM ${TABLE} WHERE source IN {vals:Array(String)} ORDER BY id`,
        { vals: "['api','worker']" },
    );

    console.log("\n4. Full-text: hasToken / position with bound terms");
    await probe(
        "hasToken with a parameter",
        `SELECT message FROM ${TABLE} WHERE hasToken(message_lower, {t:String}) ORDER BY id`,
        { t: "refused" },
    );
    await probe(
        "phrase: two tokens plus adjacency",
        `SELECT message FROM ${TABLE}
         WHERE hasToken(message_lower, {a:String}) AND hasToken(message_lower, {b:String})
           AND position(message_lower, {p:String}) > 0 ORDER BY id`,
        { a: "connection", b: "refused", p: "connection refused" },
    );
    await probe(
        "negation",
        `SELECT message FROM ${TABLE} WHERE NOT hasToken(message_lower, {t:String}) ORDER BY id`,
        { t: "debug" },
    );
    await probe(
        "hasToken on a term containing a separator",
        `SELECT count() AS n FROM ${TABLE} WHERE hasToken(message_lower, {t:String})`,
        { t: "connection refused" },
    );
    await probe(
        "hasToken on the empty string",
        `SELECT count() AS n FROM ${TABLE} WHERE hasToken(message_lower, {t:String})`,
        { t: "" },
    );
    await probe(
        "how the tokenizer splits a message",
        `SELECT tokens(lowerUTF8({m:String})) AS t`,
        { m: "Timeout after 30s, connection-refused." },
    );

    console.log("\n5. Keyset pagination as a tuple comparison");
    await probe(
        "(timestamp, id) < (ts, id)",
        `SELECT message FROM ${TABLE}
         WHERE project_id = {p:UUID} AND (timestamp, id) < ({ts:DateTime64(3,'UTC')}, {cid:UUID})
         ORDER BY timestamp DESC, id DESC`,
        { p: PROJECT, ts: "2026-08-26 10:00:02.000", cid: "01920000-0000-7000-8000-000000000003" },
    );
    await probe(
        "the unix-timestamp form @clickhouse/client sends for a JS Date",
        `SELECT toString({ts:DateTime64(3,'UTC')}) AS parsed`,
        { ts: `${Math.floor(Date.UTC(2026, 7, 26, 10, 0, 0) / 1000)}.123` },
    );

    console.log("\n6. Facets: the empty string is the new NULL");
    await probe(
        "group by, blank folded to a label",
        `SELECT if(environment = '', '(unset)', environment) AS value, count() AS count
         FROM ${TABLE} WHERE project_id = {p:UUID}
         GROUP BY value ORDER BY count DESC, value LIMIT 20`,
        { p: PROJECT },
    );
    await probe(
        "level facet, and what type count() comes back as",
        `SELECT toString(level) AS value, count() AS count FROM ${TABLE} WHERE project_id = {p:UUID}
         GROUP BY level ORDER BY count DESC, value`,
        { p: PROJECT },
    );

    console.log("\n7. count() for the alert evaluator");
    const n = await one(
        `SELECT count() AS n FROM ${TABLE} WHERE project_id = {p:UUID} AND level IN {levels:Array(String)}`,
        { params: { p: PROJECT, levels: "['error','fatal']" } },
    );
    console.log(`    => ${JSON.stringify(n)}`);

    await exec(`DROP TABLE IF EXISTS ${TABLE}`);
    console.log("\ndone\n");
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
