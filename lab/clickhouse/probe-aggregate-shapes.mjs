/**
 * Phase 4 probe: the shapes the dashboard aggregations are written against.
 *
 * Same purpose and same order as the Phase 3 probes — settle against a real
 * server what the code will assume, before the code assumes it. Not a
 * benchmark. Creates and drops its own table.
 *
 *     node lab/clickhouse/probe-aggregate-shapes.mjs
 */
import { exec, rows } from "./ch.mjs";

const T = "probe_agg_events";

function show(label, value) {
    console.log(`\n── ${label}\n${JSON.stringify(value, null, 2)}`);
}

async function tryIt(label, fn) {
    try {
        show(label, await fn());
    } catch (err) {
        show(`${label}  [THREW]`, String(err.message).split("\n").slice(0, 3));
    }
}

await exec(`DROP TABLE IF EXISTS ${T}`);
await exec(`
    CREATE TABLE ${T} (
        project_id UUID,
        timestamp  DateTime64(3, 'UTC'),
        id         UUID,
        level      Enum8('debug'=1,'info'=2,'warn'=3,'error'=4,'fatal'=5),
        message    String,
        source     LowCardinality(String),
        environment LowCardinality(String),
        template_hash UInt64,
        message_template String
    ) ENGINE = MergeTree ORDER BY (project_id, timestamp, id)
`);

const P1 = "11111111-1111-7111-8111-111111111111";
const P2 = "22222222-2222-7222-8222-222222222222";
const base = "2026-08-26 10:00:00.000";

await exec(`
    INSERT INTO ${T} VALUES
    ('${P1}', '${base}', generateUUIDv4(), 'info',  'user 1 in', 'api', 'prod', 100, 'user *** in'),
    ('${P1}', '2026-08-26 10:00:30.000', generateUUIDv4(), 'error', 'user 2 in', 'api', '',     100, 'user *** in'),
    ('${P1}', '2026-08-26 10:04:00.000', generateUUIDv4(), 'fatal', 'boom',      '',    'prod', 200, 'boom'),
    ('${P2}', '${base}', generateUUIDv4(), 'info',  'user 3 in', 'web', 'prod', 100, 'user *** in')
`);

// 1. Can the bucket width be a bound parameter?
await tryIt("toStartOfInterval with a bound second count", () =>
    rows(
        `SELECT toStartOfInterval(timestamp, toIntervalSecond({secs:UInt32})) AS ts,
                toTypeName(ts) AS type, count() AS n
         FROM ${T} GROUP BY ts ORDER BY ts`,
        { params: { secs: 300 } },
    ),
);

// 1b. The epoch-floor arithmetic straight to milliseconds, which is what every
// other read returns and what `new Date()` takes.
await tryIt("epoch floor straight to millis", () =>
    rows(
        `SELECT intDiv(toUnixTimestamp(timestamp), {secs:UInt32}) * {secs:UInt32} * 1000 AS ts_ms,
                toTypeName(ts_ms) AS type, count() AS n
         FROM ${T} GROUP BY ts_ms ORDER BY ts_ms`,
        { params: { secs: 300 } },
    ),
);

// 2. Does epoch-floor arithmetic agree with it? (Postgres used the arithmetic.)
await tryIt("epoch floor vs toStartOfInterval", () =>
    rows(
        `SELECT toStartOfInterval(timestamp, toIntervalSecond({secs:UInt32})) AS a,
                toDateTime64(intDiv(toUnixTimestamp(timestamp), {secs:UInt32}) * {secs:UInt32}, 3, 'UTC') AS b,
                a = b AS same
         FROM ${T} ORDER BY timestamp`,
        { params: { secs: 21600 } },
    ),
);

// 3. argMin over a tuple containing a UUID — the "owning project" rule.
await tryIt("argMin over (-per_project, project_id)", () =>
    rows(`
        SELECT template_hash,
               sum(per_project) AS total,
               any(template) AS message,
               argMin(project_id, (-toInt64(per_project), project_id)) AS owner
        FROM (
            SELECT template_hash, project_id,
                   count() AS per_project,
                   any(message_template) AS template
            FROM ${T} GROUP BY template_hash, project_id
        )
        GROUP BY template_hash ORDER BY total DESC, message
    `),
);

// 3b. The tie-break half of the same rule: equal counts must pick the smaller
// project_id, which is what Postgres's ROW_NUMBER ... ORDER BY total DESC,
// project_id did.
await tryIt("argMin tie-break picks the smaller project_id", () =>
    rows(`
        SELECT argMin(project_id, (-toInt64(per_project), project_id)) AS owner
        FROM (
            SELECT project_id, count() AS per_project
            FROM ${T} WHERE template_hash = 100 AND level = 'info'
            GROUP BY project_id
        )
    `),
);

// 4. LIMIT n BY — the per-project top row.
await tryIt("LIMIT 1 BY project_id", () =>
    rows(`
        SELECT project_id, message_template, count() AS n
        FROM ${T} GROUP BY project_id, message_template
        ORDER BY project_id, n DESC, message_template
        LIMIT 1 BY project_id
    `),
);

// 5. groupUniqArray over a LowCardinality column.
await tryIt("groupUniqArray(environment)", () =>
    rows(`
        SELECT project_id, groupUniqArray(environment) AS envs
        FROM ${T} WHERE environment != '' GROUP BY project_id ORDER BY project_id
    `),
);

// 6. How do UInt64 aggregates come back in JSONEachRow, quoted or not?
await tryIt("count() quoting, default settings", () => rows(`SELECT count() AS n FROM ${T}`));
await tryIt("count() quoting, quote_64bit off", () =>
    rows(`SELECT count() AS n FROM ${T}`, {
        settings: { output_format_json_quote_64bit_integers: 0 },
    }),
);

// 7. max(timestamp) has to come back as epoch millis, like every other read.
await tryIt("max(timestamp) raw vs converted", () =>
    rows(`SELECT max(timestamp) AS raw, toUnixTimestamp64Milli(max(timestamp)) AS ms FROM ${T}`),
);

// 8. The '(unset)' / '(unknown)' relabelling, and whether it can be grouped.
await tryIt("if(col='', label, col) as a GROUP BY key", () =>
    rows(`
        SELECT if(source = '', '(unknown)', source) AS source, count() AS n
        FROM ${T} GROUP BY source ORDER BY n DESC, source
    `),
);

// 9. An IN over an array parameter of UUIDs.
await tryIt("project_id IN {ids:Array(UUID)}", () =>
    rows(`SELECT count() AS n FROM ${T} WHERE project_id IN {ids:Array(UUID)}`, {
        params: { ids: `['${P1}','${P2}']` },
    }),
);

// 10. countIf over an Enum8 compared to a string literal.
await tryIt("countIf(level IN ('error','fatal'))", () =>
    rows(`SELECT count() AS total, countIf(level IN ('error','fatal')) AS errors FROM ${T}`),
);

// 11. Does an empty result set come back as zero rows or one row of zeros?
await tryIt("aggregate over no matching rows", () =>
    rows(`SELECT count() AS n, max(timestamp) AS latest FROM ${T} WHERE project_id = {p:UUID}`, {
        params: { p: "33333333-3333-7333-8333-333333333333" },
    }),
);
await tryIt("GROUP BY over no matching rows", () =>
    rows(`SELECT project_id, count() AS n FROM ${T} WHERE project_id = {p:UUID} GROUP BY project_id`, {
        params: { p: "33333333-3333-7333-8333-333333333333" },
    }),
);

// 12. DISTINCT over a LowCardinality column, ordered.
await tryIt("SELECT DISTINCT if(environment='','(unset)',environment)", () =>
    rows(`
        SELECT DISTINCT if(environment = '', '(unset)', environment) AS environment
        FROM ${T} ORDER BY environment
    `),
);

await exec(`DROP TABLE IF EXISTS ${T}`);
console.log("\ndone");
