/**
 * A ~50-line ClickHouse HTTP client for the lab.
 *
 * **Deliberately not `@clickhouse/client`.** Phase 0 exists to decide whether
 * this migration happens at all; adding a dependency to `package.json` before
 * that decision would be the first irreversible-feeling step of a thing that is
 * still a question. Node 22 has `fetch`, and ClickHouse's HTTP interface takes
 * SQL in a request body. That is the whole requirement.
 *
 * If the migration goes ahead, the real client arrives in Phase 1 and this file
 * is deleted with the rest of `lab/`.
 */

const URL_BASE = process.env.CH_URL ?? "http://localhost:8123";
const USER = process.env.CH_USER ?? "logger";
const PASSWORD = process.env.CH_PASSWORD ?? "logger";
const DATABASE = process.env.CH_DATABASE ?? "logger";

function endpoint(params = {}) {
    const url = new URL(URL_BASE);
    url.searchParams.set("database", DATABASE);
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
    }
    return url;
}

const headers = () => ({
    Authorization: `Basic ${Buffer.from(`${USER}:${PASSWORD}`).toString("base64")}`,
});

/**
 * Run a statement. Returns raw text — callers that want rows use `rows()`.
 *
 * Errors are thrown with ClickHouse's own message. The alternative — a generic
 * "request failed" — turns every schema typo into a debugging session.
 */
export async function exec(sql, { params = {}, settings = {} } = {}) {
    const res = await fetch(endpoint({ ...settings, ...prefixParams(params) }), {
        method: "POST",
        headers: headers(),
        body: sql,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`ClickHouse ${res.status}: ${text.trim()}`);
    return text;
}

/** Query parameters go over the wire as `param_<name>`, never interpolated. */
function prefixParams(params) {
    return Object.fromEntries(Object.entries(params).map(([k, v]) => [`param_${k}`, v]));
}

/** Run a SELECT and parse `JSONEachRow` into objects. */
export async function rows(sql, options = {}) {
    const text = await exec(sql, {
        ...options,
        settings: { ...options.settings, default_format: "JSONEachRow" },
    });
    return text
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
}

/** Run a SELECT expected to return exactly one row. */
export async function one(sql, options = {}) {
    const [row] = await rows(sql, options);
    return row;
}

/** Insert newline-delimited JSON into a table. */
export async function insertJsonEachRow(table, ndjson, settings = {}) {
    return exec(`INSERT INTO ${table} FORMAT JSONEachRow\n${ndjson}`, { settings });
}

/**
 * `fetch` throws a bare `TypeError: fetch failed` for anything at the transport
 * layer — container not up, port not published, backend refusing — and the
 * cause is on `err.cause`, not on the message. Reporting the message alone is
 * how a mounted-over config file reads as "fetch failed" and tells you nothing.
 */
export async function ping() {
    let res;
    try {
        res = await fetch(`${URL_BASE}/ping`);
    } catch (err) {
        const cause = err.cause?.code ?? err.cause?.message ?? err.message;
        throw new Error(
            `ClickHouse not reachable at ${URL_BASE} (${cause}).\n` +
                `  is it up?      docker compose -f lab/clickhouse/docker-compose.yml ps\n` +
                `  what does it say?  docker compose -f lab/clickhouse/docker-compose.yml logs --tail 40\n` +
                `  note: a healthy container can still be unreachable from the host — the\n` +
                `  healthcheck runs inside it. Check that it listens on :: and not 127.0.0.1.`,
        );
    }
    if (!res.ok) throw new Error(`ClickHouse at ${URL_BASE} answered ${res.status} to /ping`);
    return true;
}

export { DATABASE };
