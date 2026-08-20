/**
 * events-batch-by-key — high-volume ingest load, sent in batches of up to 500
 * events per request, authenticated by an API key over the public HTTP API.
 *
 * Use this one to *fill* a database. For a steady trickle that makes the
 * dashboard move in real time, use `event-one-by-key.mjs` instead.
 *
 * Usage:
 *   LOGGER_API_KEY=lgr_xxx node scripts/events-batch-by-key.mjs
 *   PowerShell: $env:LOGGER_API_KEY="lgr_xxx"; node scripts/events-batch-by-key.mjs
 *
 * ⚠️  Rate limiting is per API key (`RATE_LIMIT_PER_MIN` in .env, default 1000,
 *     overridable per key in the UI). Batch requests consume one unit per
 *     event, not one per request, so EVENTS_PER_MINUTE is the number that
 *     matters. Running exactly at the ceiling still trips 429 on window
 *     boundaries and each one costs a full Retry-After minute, so the default
 *     below leaves ~4% headroom under a 1000/min limit.
 *
 * Stop with Ctrl-C: the run finishes its current batch, then prints a summary.
 */

import { pathToFileURL } from "node:url";
import { buildEvent, parseRetryAfterMs, sleep } from "./event-factory.mjs";

// ── configuration ────────────────────────────────────────────────────────────

/** Ingest endpoint host. No trailing slash. Override with LOGGER_URL. */
export const BASE_URL = process.env.LOGGER_URL ?? "https://stage.proeball.com";

/**
 * API key for the target project, shown once at creation time in the UI.
 * Supply it as LOGGER_API_KEY rather than editing this file — the repository is
 * public, and a committed key is a leaked key. `scripts/demo-live.mjs` reads the
 * same variable.
 */
export const API_KEY = process.env.LOGGER_API_KEY ?? "";

/**
 * The event to send. Edit freely — every field the ingest schema accepts is
 * allowed here (see docs/reference/api.md#event-schema). Only `level` and
 * `message` are required; `timestamp` is deliberately omitted so the server
 * stamps each event with its own `now()`.
 */
export const EVENT = {
    level: "info",
    message: "Synthetic load event",
    source: "loadgen",
    environment: "staging",
    release: "0.1.0-rc1",
    attributes: {
        latency_ms: 42,
        cached: false,
        route: "/api/ingest",
    },
};

/** Vary each event around EVENT. Attribute *types* are preserved either way. */
export const RANDOMIZE = true;

/** Target throughput. Keep below the key's per-minute rate limit, not equal to it. */
export const EVENTS_PER_MINUTE = 960;

/** Events per request. The batch endpoint caps at 500. */
export const BATCH_SIZE = 500;

/** Stop after this many events. */
export const TOTAL_EVENTS = 2_000_000;

/** Progress line interval. */
export const REPORT_EVERY_MS = 30_000;

// ── pacing (exported for tests) ──────────────────────────────────────────────

/** Milliseconds to wait between batches to hit `eventsPerMinute`. */
export function delayBetweenBatchesMs(eventsPerMinute, batchSize) {
    if (eventsPerMinute <= 0) throw new Error("eventsPerMinute must be positive");
    if (batchSize <= 0) throw new Error("batchSize must be positive");
    return Math.round((60_000 * batchSize) / eventsPerMinute);
}

/** Size of the next batch, so the run stops exactly on `total`. */
export function nextBatchSize(sent, total, batchSize) {
    return Math.max(0, Math.min(batchSize, total - sent));
}

// ── runner ───────────────────────────────────────────────────────────────────

async function sendBatch(events) {
    const started = Date.now();
    const response = await fetch(`${BASE_URL}/api/ingest/batch`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${API_KEY}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(events),
    });

    const latencyMs = Date.now() - started;
    let body = null;
    try {
        body = await response.json();
    } catch {
        // Error bodies are JSON too, but never assume — an upstream proxy
        // error page would otherwise crash the whole run.
    }

    return {
        status: response.status,
        retryAfterMs: parseRetryAfterMs(response.headers.get("retry-after")),
        accepted: body?.accepted ?? (response.status === 202 ? events.length : 0),
        error: body?.error ?? null,
        latencyMs,
    };
}

async function main() {
    if (!API_KEY || !API_KEY.startsWith("lgr_")) {
        console.error("API_KEY is missing or does not look like a Logger key (lgr_...).");
        process.exit(1);
    }

    const pauseMs = delayBetweenBatchesMs(EVENTS_PER_MINUTE, BATCH_SIZE);
    let stopping = false;
    process.on("SIGINT", () => {
        if (stopping) process.exit(130);
        stopping = true;
        console.log("\nStopping after the current batch — Ctrl-C again to abort now.");
    });

    const startedAt = Date.now();
    let sent = 0;
    let accepted = 0;
    let rejected = 0;
    let failedRequests = 0;
    let throttled = 0;
    let latencySum = 0;
    let requests = 0;
    let lastReport = Date.now();

    console.log(
        `events-batch-by-key → ${BASE_URL}\n` +
            `  target      ${EVENTS_PER_MINUTE.toLocaleString()} events/min ` +
            `(${BATCH_SIZE} per request, one every ${pauseMs} ms)\n` +
            `  total       ${TOTAL_EVENTS.toLocaleString()} events\n` +
            `  estimated   ${(TOTAL_EVENTS / EVENTS_PER_MINUTE / 60).toFixed(1)} hours\n` +
            `  randomize   ${RANDOMIZE}\n`,
    );

    while (!stopping && sent < TOTAL_EVENTS) {
        const size = nextBatchSize(sent, TOTAL_EVENTS, BATCH_SIZE);
        if (size === 0) break;

        const events = Array.from({ length: size }, () => buildEvent(EVENT, RANDOMIZE));

        let result;
        try {
            result = await sendBatch(events);
        } catch (error) {
            failedRequests += 1;
            console.error(`[${new Date().toISOString()}] request failed: ${error.message} — retrying in 5s`);
            await sleep(5_000);
            continue;
        }

        requests += 1;
        latencySum += result.latencyMs;

        if (result.status === 429) {
            throttled += 1;
            console.warn(
                `[${new Date().toISOString()}] 429 rate limited — waiting ${result.retryAfterMs} ms. ` +
                    `EVENTS_PER_MINUTE (${EVENTS_PER_MINUTE}) is above this key's limit.`,
            );
            await sleep(result.retryAfterMs);
            continue;
        }

        if (result.status !== 202 && result.status !== 207) {
            failedRequests += 1;
            console.error(
                `[${new Date().toISOString()}] HTTP ${result.status}: ${result.error ?? "unknown error"} — retrying in 5s`,
            );
            await sleep(5_000);
            continue;
        }

        sent += size;
        accepted += result.accepted;
        rejected += size - result.accepted;

        if (Date.now() - lastReport >= REPORT_EVERY_MS) {
            const elapsedMin = (Date.now() - startedAt) / 60_000;
            const observedRate = accepted / elapsedMin || 1;
            console.log(
                `[${new Date().toISOString()}] ` +
                    `sent=${sent.toLocaleString()} accepted=${accepted.toLocaleString()} ` +
                    `rejected=${rejected} failed_req=${failedRequests} throttled=${throttled} ` +
                    `rate=${Math.round(observedRate).toLocaleString()}/min ` +
                    `avg=${Math.round(latencySum / requests)}ms ` +
                    `eta=${((TOTAL_EVENTS - sent) / observedRate).toFixed(0)}min`,
            );
            lastReport = Date.now();
        }

        await sleep(pauseMs);
    }

    const elapsedMin = (Date.now() - startedAt) / 60_000;
    console.log(
        `\nfinished after ${elapsedMin.toFixed(1)} min\n` +
            `  sent            ${sent.toLocaleString()}\n` +
            `  accepted        ${accepted.toLocaleString()}\n` +
            `  rejected        ${rejected.toLocaleString()}\n` +
            `  failed requests ${failedRequests}\n` +
            `  throttled       ${throttled}\n` +
            `  average rate    ${Math.round(accepted / elapsedMin).toLocaleString()}/min\n` +
            `  average latency ${requests ? Math.round(latencySum / requests) : 0} ms`,
    );
}

// Only run when executed directly, so importing the helpers in a test does not
// start firing traffic at a live install. `pathToFileURL` rather than string
// concatenation: on Windows a file URL is `file:///D:/...` with three slashes,
// and a hand-built `file://` + path never matches.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await main();
}
