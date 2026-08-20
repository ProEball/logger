/**
 * event-one-by-key — one HTTP request per event, at a rate that drifts between
 * MIN_PER_MINUTE and MAX_PER_MINUTE so the dashboard draws a moving curve
 * rather than a flat line. Authenticated by an API key.
 *
 * This is the "watch it live" script. To *fill* a database quickly, use
 * `events-batch-by-key.mjs` — batching costs roughly 1 ms per event against
 * ~70 ms for a single request, so it is about seventy times cheaper per event.
 *
 * Usage:
 *   LOGGER_API_KEY=lgr_xxx node scripts/event-one-by-key.mjs
 *   PowerShell: $env:LOGGER_API_KEY="lgr_xxx"; node scripts/event-one-by-key.mjs
 *
 * ⚠️  Rate limiting is per API key (`RATE_LIMIT_PER_MIN` in .env, default
 *     1000). MAX_PER_MINUTE must stay under it.
 *
 * Runs until Ctrl-C: in-flight requests are drained, then a summary prints.
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
// No default. A key baked in here is a key published: this repository is
// public, and a literal in a committed file survives its own deletion — it
// stays in the history and in the forks and caches that history reaches.
export const API_KEY = process.env.LOGGER_API_KEY ?? "";

/**
 * The event to send. Edit freely — every field the ingest schema accepts is
 * allowed here (see docs/reference/api.md#event-schema). `timestamp` is
 * deliberately omitted so the server stamps each event with its own `now()`,
 * which is what puts them in the live end of the dashboard.
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

/** Rate envelope. The send rate oscillates smoothly between these. */
export const MIN_PER_MINUTE = 750;
export const MAX_PER_MINUTE = 950;

/** Time for one full min → max → min oscillation. */
export const WAVE_PERIOD_MS = 10 * 60_000;

/** Random noise on top of the wave, as a fraction. 0 disables it. */
export const JITTER = 0.08;

/** Stop after this many events. Infinity means "until Ctrl-C". */
export const TOTAL_EVENTS = Infinity;

/**
 * Requests allowed in flight at once. Pacing is decoupled from latency: a
 * slow response must not drag the send rate down with it. Requests beyond
 * this cap are skipped and counted, which is the signal that the target rate
 * is beyond what the network or the server will sustain.
 */
export const MAX_IN_FLIGHT = 16;

/** Progress line interval. */
export const REPORT_EVERY_MS = 15_000;

// ── pacing (exported for tests) ──────────────────────────────────────────────

/**
 * Target rate at a point in the run: a sine wave across [min, max] with
 * optional noise. Sine rather than a random re-roll because a step function
 * makes the dashboard look like it is glitching, and the point of this script
 * is a graph that reads as traffic.
 */
export function targetRateAt(elapsedMs, options = {}, random = Math.random) {
    const {
        min = MIN_PER_MINUTE,
        max = MAX_PER_MINUTE,
        periodMs = WAVE_PERIOD_MS,
        jitter = JITTER,
    } = options;

    if (min <= 0) throw new Error("min must be positive");
    if (max < min) throw new Error("max must be >= min");
    if (periodMs <= 0) throw new Error("periodMs must be positive");

    const mid = (min + max) / 2;
    const amplitude = (max - min) / 2;
    const wave = mid + amplitude * Math.sin((2 * Math.PI * elapsedMs) / periodMs);
    const noisy = jitter > 0 ? wave * (1 + (random() * 2 - 1) * jitter) : wave;

    return Math.min(max, Math.max(min, Math.round(noisy)));
}

/** Milliseconds between single requests to hit `eventsPerMinute`. */
export function intervalMs(eventsPerMinute) {
    if (eventsPerMinute <= 0) throw new Error("eventsPerMinute must be positive");
    return 60_000 / eventsPerMinute;
}

// ── runner ───────────────────────────────────────────────────────────────────

async function sendOne(event) {
    const started = Date.now();
    const response = await fetch(`${BASE_URL}/api/ingest`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${API_KEY}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(event),
    });

    let body = null;
    try {
        body = await response.json();
    } catch {
        // See events-batch-by-key.mjs — never assume the body parses.
    }

    return {
        status: response.status,
        retryAfterMs: parseRetryAfterMs(response.headers.get("retry-after")),
        error: body?.error ?? null,
        latencyMs: Date.now() - started,
    };
}

async function main() {
    if (!API_KEY || !API_KEY.startsWith("lgr_")) {
        console.error("API_KEY is missing or does not look like a Logger key (lgr_...).");
        process.exit(1);
    }

    let stopping = false;
    process.on("SIGINT", () => {
        if (stopping) process.exit(130);
        stopping = true;
        console.log("\nDraining in-flight requests — Ctrl-C again to abort now.");
    });

    const startedAt = Date.now();
    let dispatched = 0;
    let accepted = 0;
    let failed = 0;
    let throttled = 0;
    let skipped = 0;
    let inFlight = 0;
    let latencySum = 0;
    let completed = 0;
    let throttledUntil = 0;
    let lastReport = Date.now();
    let windowStart = Date.now();
    let windowAccepted = 0;

    console.log(
        `event-one-by-key → ${BASE_URL}\n` +
            `  rate        ${MIN_PER_MINUTE}–${MAX_PER_MINUTE} events/min, ` +
            `one request each, oscillating over ${(WAVE_PERIOD_MS / 60_000).toFixed(0)} min\n` +
            `  total       ${TOTAL_EVENTS === Infinity ? "unlimited (Ctrl-C to stop)" : TOTAL_EVENTS.toLocaleString()}\n` +
            `  randomize   ${RANDOMIZE}\n`,
    );

    let nextAt = Date.now();

    while (!stopping && dispatched < TOTAL_EVENTS) {
        const rate = targetRateAt(Date.now() - startedAt);
        nextAt += intervalMs(rate);

        const wait = nextAt - Date.now();
        if (wait > 0) {
            await sleep(wait);
        } else if (wait < -1_000) {
            // More than a second behind: the schedule is unreachable, so reset
            // rather than accumulate a debt that turns into a burst later.
            nextAt = Date.now();
        }

        if (Date.now() < throttledUntil) continue;

        if (inFlight >= MAX_IN_FLIGHT) {
            skipped += 1;
            continue;
        }

        dispatched += 1;
        inFlight += 1;

        sendOne(buildEvent(EVENT, RANDOMIZE))
            .then((result) => {
                completed += 1;
                latencySum += result.latencyMs;
                if (result.status === 202) {
                    accepted += 1;
                    windowAccepted += 1;
                } else if (result.status === 429) {
                    throttled += 1;
                    throttledUntil = Date.now() + result.retryAfterMs;
                    console.warn(
                        `[${new Date().toISOString()}] 429 rate limited — pausing ${result.retryAfterMs} ms. ` +
                            `MAX_PER_MINUTE (${MAX_PER_MINUTE}) is above this key's limit.`,
                    );
                } else {
                    failed += 1;
                    console.error(`[${new Date().toISOString()}] HTTP ${result.status}: ${result.error ?? "unknown"}`);
                }
            })
            .catch((error) => {
                completed += 1;
                failed += 1;
                console.error(`[${new Date().toISOString()}] request failed: ${error.message}`);
            })
            .finally(() => {
                inFlight -= 1;
            });

        if (Date.now() - lastReport >= REPORT_EVERY_MS) {
            const windowMin = (Date.now() - windowStart) / 60_000;
            console.log(
                `[${new Date().toISOString()}] ` +
                    `target=${rate}/min actual=${Math.round(windowAccepted / windowMin)}/min ` +
                    `accepted=${accepted.toLocaleString()} failed=${failed} throttled=${throttled} ` +
                    `skipped=${skipped} in_flight=${inFlight} ` +
                    `avg=${completed ? Math.round(latencySum / completed) : 0}ms`,
            );
            lastReport = Date.now();
            windowStart = Date.now();
            windowAccepted = 0;
        }
    }

    while (inFlight > 0) await sleep(50);

    const elapsedMin = (Date.now() - startedAt) / 60_000;
    console.log(
        `\nfinished after ${elapsedMin.toFixed(1)} min\n` +
            `  dispatched      ${dispatched.toLocaleString()}\n` +
            `  accepted        ${accepted.toLocaleString()}\n` +
            `  failed          ${failed}\n` +
            `  throttled       ${throttled}\n` +
            `  skipped (busy)  ${skipped}\n` +
            `  average rate    ${Math.round(accepted / elapsedMin).toLocaleString()}/min\n` +
            `  average latency ${completed ? Math.round(latencySum / completed) : 0} ms`,
    );
}

// Only run when executed directly — see events-batch-by-key.mjs for why this
// uses pathToFileURL rather than string concatenation.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await main();
}
