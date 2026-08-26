/**
 * Phase 3, part two — what a row *looks like* coming back out.
 *
 * The write path had to learn three type rejections the hard way (§12.2). The
 * read path has the mirror-image problem: JSONEachRow renders several of these
 * column types in a form JavaScript does not accept back without help —
 * `DateTime64` is not an ISO string, `UInt64` is a string, and `JSON` comes back
 * as a nested object whose leaf types are whatever was stored. The reverse
 * mapper is written against these answers, not against a guess.
 *
 *     node lab/clickhouse/probe-read-shapes.mjs
 */

import { exec, rows, ping, insertJsonEachRow } from "./ch.mjs";

const TABLE = "probe_read_shapes";

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
            environment   LowCardinality(String),
            template_hash UInt64,
            attributes    JSON(max_dynamic_paths = 2048),
            context       String,
            ip            IPv6
        )
        ENGINE = MergeTree ORDER BY (project_id, timestamp, id)
    `);
    await insertJsonEachRow(
        TABLE,
        [
            JSON.stringify({
                project_id: "11111111-1111-4111-8111-111111111111",
                timestamp: "2026-08-26 10:00:00.123",
                id: "01920000-0000-7000-8000-000000000001",
                level: "warn",
                message: "hello",
                environment: "",
                // Above 2^53 on purpose: the fingerprint is a 64-bit hash and
                // Number() would quietly lose the low bits.
                template_hash: "18446744073709551615",
                attributes: { order_id: "o_1", retries: 2, ok: true, ratio: 1.5 },
                context: '{"path":"/login"}',
                ip: "::ffff:203.0.113.7",
            }),
            JSON.stringify({
                project_id: "11111111-1111-4111-8111-111111111111",
                timestamp: "2026-08-26 10:00:01.000",
                id: "01920000-0000-7000-8000-000000000002",
                level: "info",
                message: "second",
                environment: "production",
                template_hash: "0",
                attributes: {},
                context: "{}",
                ip: "::",
            }),
        ].join("\n"),
    );
}

async function probe(label, sql, params) {
    const flat = sql.trim().replace(/\s+/g, " ");
    try {
        console.log(`\n  ${label}\n    ${flat}\n    => ${JSON.stringify(await rows(sql, { params }), null, 0)}`);
    } catch (err) {
        console.log(`\n  ${label}\n    ${flat}\n    XX ${err.message.split("\n")[0]}`);
    }
}

async function main() {
    await ping();
    await setup();

    console.log("\n1. SELECT * — the naive form");
    await probe("every column, default rendering", `SELECT * FROM ${TABLE} ORDER BY id`);

    console.log("\n2. The timestamp, three ways");
    await probe(
        "raw / toString / epoch millis",
        `SELECT timestamp, toString(timestamp) AS as_text, toUnixTimestamp64Milli(timestamp) AS ms FROM ${TABLE} ORDER BY id LIMIT 1`,
    );

    console.log("\n3. The JSON column");
    await probe(
        "as an object vs as text",
        `SELECT attributes, toString(attributes) AS as_text FROM ${TABLE} ORDER BY id`,
    );
    await probe("leaf types", `SELECT toTypeName(attributes) AS t FROM ${TABLE} LIMIT 1`);

    console.log("\n4. Does a missing JSON path differ from one stored empty?");
    await probe(
        "dynamicType of a path that exists, one that does not, and one stored as ''",
        `SELECT dynamicType(getSubcolumn(attributes, 'order_id')) AS present,
                dynamicType(getSubcolumn(attributes, 'nope'))     AS absent
         FROM ${TABLE} ORDER BY id LIMIT 1`,
    );
    await probe(
        "equality against '' would match rows lacking the key entirely",
        `SELECT count() AS n FROM ${TABLE} WHERE toString(getSubcolumn(attributes, {key:String})) = ''`,
        { key: "nope" },
    );
    await probe(
        "...unless existence is asserted first",
        `SELECT count() AS n FROM ${TABLE}
         WHERE dynamicType(getSubcolumn(attributes, {key:String})) != 'None'
           AND toString(getSubcolumn(attributes, {key:String})) = ''`,
        { key: "nope" },
    );

    console.log("\n5. UInt64 and the enum");
    await probe(
        "template_hash at the top of the range, and level",
        `SELECT template_hash, level FROM ${TABLE} ORDER BY id LIMIT 1`,
    );

    console.log("\n6. IPv6");
    await probe("v4-mapped and unset", `SELECT ip FROM ${TABLE} ORDER BY id`);

    await exec(`DROP TABLE IF EXISTS ${TABLE}`);
    console.log("\ndone\n");
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
