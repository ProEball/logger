/**
 * Demo live event stream — sends events through the ingest HTTP API in real time.
 *
 * Usage:
 *   node scripts/demo-live.mjs
 *   node scripts/demo-live.mjs --url http://localhost:3000
 *   node scripts/demo-live.mjs --burst 5   # events per tick
 *
 * The key comes from LOGGER_API_KEY in .env.local (gitignored); --key overrides
 * it for a one-off run. This script uses slot 1 only — the two load generators
 * take a slot argument, a demo has one project to show.
 *
 * Press Ctrl+C to stop.
 */

import { randomUUID } from "crypto";
import { config } from "dotenv";

// The keys live in .env.local so they are typed once rather than into every
// terminal — which is how one of them ended up committed to a script.
config({ path: ".env.local", quiet: true });

// ── CLI / env ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const flag = (name) => {
    const i = args.indexOf(name);
    return i !== -1 ? args[i + 1] : undefined;
};

const BASE_URL = flag("--url") ?? process.env.LOGGER_URL ?? "http://localhost:3000";
const API_KEY  = flag("--key") ?? process.env.LOGGER_API_KEY ?? "";
const MAX_BURST = parseInt(flag("--burst") ?? "3", 10);
const MIN_DELAY_MS = 600;
const MAX_DELAY_MS = 1800;

if (!API_KEY) {
    console.error(
        "\n  Missing API key.\n" +
        "  Set LOGGER_API_KEY in .env.local, or pass --key lgr_xxx for a one-off run.\n"
    );
    process.exit(1);
}

const ENDPOINT = `${BASE_URL}/api/ingest/batch`;

// ── ANSI colors ────────────────────────────────────────────────────────────────

const C = {
    reset:  "\x1b[0m",
    bold:   "\x1b[1m",
    dim:    "\x1b[2m",
    red:    "\x1b[31m",
    yellow: "\x1b[33m",
    cyan:   "\x1b[36m",
    white:  "\x1b[37m",
    gray:   "\x1b[90m",
    green:  "\x1b[32m",
    magenta:"\x1b[35m",
};

const LEVEL_COLOR = {
    debug: C.gray,
    info:  C.cyan,
    warn:  C.yellow,
    error: C.red,
    fatal: C.red + C.bold,
};

// ── Fixtures ───────────────────────────────────────────────────────────────────

const rand   = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

const SOURCES = ["api-gateway", "auth-service", "worker", "payment-service", "notification-svc", "cron", "frontend"];
const RELEASES = ["2.1.0", "2.1.1", "2.2.0-rc.1"];
const ENVS = ["production"];

const USERS   = Array.from({ length: 12 }, (_, i) => `u_${1000 + i * 137}`);
const SESSIONS = Array.from({ length: 8  }, () => `sess_${randomUUID().slice(0, 8)}`);
const IPS = [
    "203.0.113.42", "198.51.100.7", "91.108.4.1",
    "185.220.101.34", "104.21.0.55", "172.16.0.5",
];

const INFO_MSGS = [
    "Request completed",
    "User signed in",
    "User signed out",
    "API key validated",
    "Project created",
    "Event ingested",
    "Alert rule saved",
    "Webhook delivered",
    "Cache hit",
    "Session refreshed",
    "Background job finished in {ms}ms",
    "Batch of {n} events processed",
    "Email sent to {email}",
    "Paginated query returned {n} rows",
    "Config reloaded",
    "Rate limit check passed",
    "Health check passed",
    "Export job started",
    "Metrics snapshot captured",
    "Member invited to organisation",
];

const WARN_MSGS = [
    "Slow DB query: {ms}ms",
    "Retry {attempt}/3 for webhook delivery",
    "Rate limit at {pct}% capacity",
    "Cache miss — falling back to DB",
    "JWT expiring soon",
    "Response time degraded: {ms}ms",
    "Queue depth high: {n} pending jobs",
    "Deprecated endpoint called",
    "Missing optional field: {field}",
];

const ERROR_MSGS = [
    "Database connection timeout",
    "Webhook delivery failed with status {code}",
    "Payment processing failed: {reason}",
    "Authentication failed",
    "Unhandled exception in {handler}",
    "Third-party API returned 503",
    "Permission denied: scope {scope} required",
    "Queue worker crashed unexpectedly",
];

const ERROR_TYPES = [
    "DatabaseError", "TimeoutError", "AuthenticationError",
    "ValidationError", "NetworkError", "PaymentError", "PermissionError",
];

const STACK_TRACES = [
    `DatabaseError: Connection timeout after 5000ms
    at Pool.connect (node_modules/pg-pool/index.js:123:15)
    at async dbQuery (core/db/client.ts:45:5)
    at async EventsService.insert (features/events/services/events.service.ts:88:3)`,

    `AuthenticationError: Invalid or expired bearer token
    at verifyJwt (core/auth/jwt.ts:67:11)
    at middleware (app/api/ingest/route.ts:18:5)`,

    `NetworkError: ECONNREFUSED 10.0.0.5:6379
    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1595:16)
    at async RedisClient.connect (node_modules/ioredis/dist/Redis.js:208:9)`,

    `PaymentError: Card declined — insufficient_funds
    at PaymentGateway.charge (features/billing/services/payment.service.ts:112:7)
    at async POST (app/api/billing/route.ts:34:5)`,

    `Error: Unhandled promise rejection in cron/digest
    at Cron.run (features/cron/cron.service.ts:56:11)
    at async Worker.process (core/worker/worker.ts:29:5)`,
];

// ── Message builder ────────────────────────────────────────────────────────────

function buildMessage(level) {
    const pool = level === "error" || level === "fatal" ? ERROR_MSGS
               : level === "warn"  ? WARN_MSGS
               : INFO_MSGS;

    return rand(pool)
        .replace("{ms}",      randInt(500, 8000))
        .replace("{n}",       randInt(5, 500))
        .replace("{attempt}", randInt(1, 3))
        .replace("{pct}",     randInt(70, 95))
        .replace("{field}",   rand(["source", "release", "user_id"]))
        .replace("{email}",   `user${randInt(1, 99)}@example.com`)
        .replace("{code}",    rand(["502", "503", "504", "429"]))
        .replace("{reason}",  rand(["card_declined", "insufficient_funds", "expired_card"]))
        .replace("{handler}", rand(["POST /api/ingest", "cron/digest", "worker/cleanup"]))
        .replace("{scope}",   rand(["events:write", "alerts:manage", "api_keys:create"]));
}

function weightedLevel() {
    const r = Math.random();
    if (r < 0.02) return "fatal";
    if (r < 0.10) return "error";
    if (r < 0.22) return "warn";
    if (r < 0.72) return "info";
    return "debug";
}

// ── Event factory ──────────────────────────────────────────────────────────────

function makeEvent() {
    const level   = weightedLevel();
    const isError = level === "error" || level === "fatal";
    const source  = rand(SOURCES);

    return {
        level,
        message:     buildMessage(level),
        timestamp:   new Date().toISOString(),
        source,
        environment: rand(ENVS),
        release:     rand(RELEASES),
        user_id:     Math.random() > 0.25 ? rand(USERS)    : undefined,
        session_id:  Math.random() > 0.40 ? rand(SESSIONS) : undefined,
        request_id:  `req_${randomUUID().slice(0, 12)}`,
        trace_id:    Math.random() > 0.50 ? `trace_${randomUUID().slice(0, 16)}` : undefined,
        error_type:  isError ? rand(ERROR_TYPES) : undefined,
        stack_trace: isError && Math.random() > 0.35 ? rand(STACK_TRACES) : undefined,
        attributes: {
            http_method:  rand(["GET", "POST", "PUT", "DELETE"]),
            status_code:  isError ? rand([500, 502, 503]) : rand([200, 201, 204]),
            duration_ms:  parseFloat((Math.random() * 1200).toFixed(2)),
            path: rand([
                "/api/ingest", "/api/projects", "/api/events",
                "/api/alerts", "/api/auth/session", "/dashboard",
            ]),
        },
        context: {
            region: rand(["eu-west-1", "us-east-1", "ap-southeast-1"]),
            pod:    `pod-${randInt(1, 8)}`,
            ip:     Math.random() > 0.2 ? rand(IPS) : undefined,
        },
    };
}

// ── HTTP send ──────────────────────────────────────────────────────────────────

async function sendBatch(events) {
    const res = await fetch(ENDPOINT, {
        method:  "POST",
        headers: {
            "Content-Type":  "application/json",
            "Authorization": `Bearer ${API_KEY}`,
        },
        body: JSON.stringify(events),
    });

    if (!res.ok) {
        const text = await res.text().catch(() => "(no body)");
        throw new Error(`HTTP ${res.status}: ${text}`);
    }

    return res.json();
}

// ── Terminal output ────────────────────────────────────────────────────────────

let totalSent = 0;
let totalErrors = 0;

function logEvent(ev) {
    const lvlColor = LEVEL_COLOR[ev.level] ?? C.white;
    const lvl      = ev.level.toUpperCase().padEnd(5);
    const src      = (ev.source ?? "").padEnd(20);
    const msg      = ev.message.length > 60
        ? ev.message.slice(0, 57) + "..."
        : ev.message;

    process.stdout.write(
        `${C.gray}${new Date().toLocaleTimeString()}${C.reset}  ` +
        `${lvlColor}${lvl}${C.reset}  ` +
        `${C.dim}${src}${C.reset}  ` +
        `${msg}\n`
    );
}

function logStatus(batchSize, ok) {
    const icon   = ok ? `${C.green}✓${C.reset}` : `${C.red}✗${C.reset}`;
    const totals = `${C.gray}(total sent: ${totalSent}, errors: ${totalErrors})${C.reset}`;
    process.stdout.write(
        `${icon} Batch of ${batchSize} dispatched  ${totals}\n\n`
    );
}

// ── Main loop ──────────────────────────────────────────────────────────────────

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function run() {
    console.log(
        `\n${C.bold}Logger demo — live event stream${C.reset}\n` +
        `${C.dim}Endpoint : ${ENDPOINT}${C.reset}\n` +
        `${C.dim}Burst    : 1–${MAX_BURST} events / tick   Delay: ${MIN_DELAY_MS}–${MAX_DELAY_MS}ms${C.reset}\n` +
        `${C.dim}Press Ctrl+C to stop.${C.reset}\n` +
        `${"─".repeat(72)}\n`
    );

    // Verify connectivity with a single test event before entering the loop
    try {
        await sendBatch([makeEvent()]);
        totalSent += 1;
        console.log(`${C.green}✓ Connected — first event sent.${C.reset}\n`);
    } catch (err) {
        console.error(`${C.red}✗ Could not reach ${ENDPOINT}: ${err.message}${C.reset}`);
        console.error(`  Make sure the dev server is running and the API key is correct.\n`);
        process.exit(1);
    }

    // Main loop
    while (true) {
        const count  = randInt(1, MAX_BURST);
        const events = Array.from({ length: count }, makeEvent);

        events.forEach(logEvent);

        try {
            await sendBatch(events);
            totalSent += count;
            logStatus(count, true);
        } catch (err) {
            totalErrors += count;
            logStatus(count, false);
            console.error(`  ${C.red}${err.message}${C.reset}\n`);
        }

        await delay(randInt(MIN_DELAY_MS, MAX_DELAY_MS));
    }
}

process.on("SIGINT", () => {
    console.log(
        `\n${"─".repeat(72)}\n` +
        `Stopped.  Total sent: ${C.green}${totalSent}${C.reset}  ` +
        `Errors: ${totalErrors > 0 ? C.red : C.green}${totalErrors}${C.reset}\n`
    );
    process.exit(0);
});

run();
