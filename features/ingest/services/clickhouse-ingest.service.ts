import { clickhouse } from "@/core/clickhouse/client";
import type { ClickhouseEventRow } from "@/core/clickhouse/event-row.types";

export const EVENTS_TABLE = "events";

/**
 * Writes events to ClickHouse.
 *
 * ## `async_insert = 1`
 *
 * Every `INSERT` creates a part, and ClickHouse wants parts built from
 * 10k–100k rows at roughly one insert a second. `ingestSingle` writes one row
 * and `ingestBatch` caps at 500, so without server-side buffering this table
 * would hit "too many parts" immediately. Async insert accumulates many client
 * requests into properly sized parts inside the server.
 *
 * Rejected: a Node-side batcher. It reimplements this in a process that may
 * have several replicas, each with its own buffer and its own crash window.
 *
 * ## `wait_for_async_insert = 1`
 *
 * Not the cautious choice — the only defensible one here. With `0` the 200 is
 * returned before the data is durable, flush errors reach nobody but
 * `system.asynchronous_insert_log`, and read-after-write breaks. A logging
 * service's whole promise is "the event you sent is here"; someone debugging
 * an incident must not have to wonder whether their code failed to log it or
 * this service dropped it. It also keeps the four e2e specs that ingest and
 * immediately assert working unchanged.
 *
 * The cost is up to `async_insert_busy_timeout_max_ms` (~200 ms) of latency.
 * If that ever proves unacceptable the answer is `POST /api/ingest/batch`,
 * where 500 events amortize to 0.4 ms each — not `wait_for_async_insert = 0`.
 *
 * Both settings live on the client (`core/clickhouse/client.ts`) so they apply
 * to every write, including any added later.
 *
 * ## The token
 *
 * `insert_deduplication_token` is passed only when the caller supplied an
 * idempotency key — see `utils/dedup-token.ts` for why it can never be derived
 * from the payload. It does nothing unless the table carries
 * `non_replicated_deduplication_window`; a plain MergeTree without it accepts
 * the setting and deduplicates nothing at all. Measured 2026-08-26
 * (`lab/clickhouse/probe-dedup.mjs`), and the window is set in
 * `core/clickhouse/schema.sql`.
 */
export async function insertEvents(
    rows: ClickhouseEventRow[],
    dedupToken: string | null,
): Promise<void> {
    if (rows.length === 0) return;

    await clickhouse.insert({
        table: EVENTS_TABLE,
        values: rows,
        format: "JSONEachRow",
        clickhouse_settings: dedupToken === null ? {} : { insert_deduplication_token: dedupToken },
    });
}
