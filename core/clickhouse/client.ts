import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { env } from "@/core/env";

/**
 * The ClickHouse connection, as a process singleton.
 *
 * Same reason as `core/db/client.ts`: every module re-evaluation under Next.js
 * hot reload would otherwise build a fresh client with its own socket pool, and
 * the connections leak until the dev server is restarted.
 *
 * There is no Drizzle dialect for ClickHouse, so this is the whole abstraction —
 * queries against `events` are raw SQL from here on. That makes parameter
 * binding a security boundary rather than a library guarantee: every
 * user-supplied value goes through `query_params`, with no exceptions and no
 * string interpolation. See docs/reference/security.md.
 */
declare global {
    var _chClient: ClickHouseClient | undefined;
}

function build(): ClickHouseClient {
    return createClient({
        url: env.CLICKHOUSE_URL,
        username: env.CLICKHOUSE_USER,
        password: env.CLICKHOUSE_PASSWORD,
        database: env.CLICKHOUSE_DATABASE,
        clickhouse_settings: {
            // The write path's two settings, on the client rather than on each
            // call so no future insert can forget them. Both are argued in
            // `features/ingest/services/clickhouse-ingest.service.ts` and in
            // docs/features/09-clickhouse.md §10; in short, `async_insert`
            // exists because this application writes 1–500 rows per request
            // against a table that wants 10k–100k rows per part, and
            // `wait_for_async_insert` because a logging service that answers
            // 202 before the event is durable cannot be debugged against.
            //
            // Harmless on the read side: ClickHouse ignores both for `SELECT`.
            async_insert: 1,
            wait_for_async_insert: 1,
        },
    });
}

export const clickhouse: ClickHouseClient = global._chClient ?? build();

if (process.env.NODE_ENV !== "production") {
    global._chClient = clickhouse;
}

/**
 * Readiness probe for `/api/health/ready`. Throws if ClickHouse cannot serve
 * this application's queries.
 *
 * **`select: true`, not the default.** On Node the default `ping()` hits the
 * built-in `/ping` endpoint, which — as `@clickhouse/client`'s own doc comment
 * says — *does not verify credentials*. A wrong `CLICKHOUSE_PASSWORD` or a
 * missing database would sail through it, and the probe would report healthy
 * while every real query failed with a 516. `select: true` issues a real
 * `SELECT`, so the server authenticates and resolves the database. That is what
 * the check is actually being asked, and it is the same failure this repository
 * has already shipped once: the `migrations` check reported `"unavailable"`
 * rather than failing, and so never ran (see `docs/reference/api.md`).
 *
 * **It also converts, rather than propagating.** `ping()` does not throw — it
 * returns `{ success: false, error }`. An `await clickhouse.ping()` with no
 * inspection of the result is a healthcheck that can never fail.
 */
export async function pingClickhouse(): Promise<void> {
    const result = await clickhouse.ping({ select: true });
    if (!result.success) throw result.error;
}
