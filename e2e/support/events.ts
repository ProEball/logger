import { createClient, type ClickHouseClient } from "@clickhouse/client";

/**
 * Reading the events store from a spec.
 *
 * Events left Postgres in Phase 4, so `withDb` can no longer answer "was this
 * event stored". Four specs asked it — through `SELECT … FROM events` — and
 * every one of them is really asking about **ingest**, which is a legitimate
 * question for an e2e test even though it never renders a pixel: it is the only
 * place the HTTP endpoint, the enrichment, the row mapper and the column types
 * are exercised together.
 *
 * What is *not* legitimate is using this to stand in for a page assertion. Six
 * of `events.spec.ts`'s nine tests and six of `dashboard.spec.ts`'s eight did
 * exactly that, which is how both suites stayed green through a read path being
 * rewritten underneath them. See the header of either file.
 *
 * A local client rather than `core/clickhouse/client.ts`: this runs in the
 * Playwright worker, which does not load the app's env schema.
 */
function client(): ClickHouseClient {
    return createClient({
        url: process.env.CLICKHOUSE_URL ?? "http://localhost:8123",
        username: process.env.CLICKHOUSE_USER ?? "logger",
        password: process.env.CLICKHOUSE_PASSWORD ?? "logger",
        database: process.env.CLICKHOUSE_DATABASE ?? "logger_test",
    });
}

/** Run one read against the e2e events table. */
export async function withEvents<T>(
    query: string,
    params: Record<string, unknown> = {},
): Promise<T[]> {
    const ch = client();
    try {
        const result = await ch.query({ query, query_params: params, format: "JSONEachRow" });
        return await result.json<T>();
    } finally {
        await ch.close();
    }
}

/** Events matching a `WHERE` fragment. `count()` is a UInt64 and arrives quoted. */
export async function countEvents(
    where: string,
    params: Record<string, unknown> = {},
): Promise<number> {
    const [row] = await withEvents<{ n: string }>(
        `SELECT count() AS n FROM events WHERE ${where}`,
        params,
    );
    return Number(row?.n ?? 0);
}

/**
 * Delete a project's events and wait for the delete to finish.
 *
 * `ALTER TABLE … DELETE` with `mutations_sync = 2` rather than a lightweight
 * `DELETE`: a mutation that is still running when the next spec inserts would
 * let a stale row be counted, and a suite that passes on the first run of the
 * day and fails later is the worst failure mode there is.
 */
export async function deleteEventsForProjects(projectIds: string[]): Promise<void> {
    if (projectIds.length === 0) return;

    const ch = client();
    try {
        await ch.command({
            query: "ALTER TABLE events DELETE WHERE project_id IN {ids:Array(UUID)}",
            query_params: { ids: projectIds },
            clickhouse_settings: { mutations_sync: "2" },
        });
    } finally {
        await ch.close();
    }
}
