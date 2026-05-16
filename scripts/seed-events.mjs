/**
 * Seed 200-300 random events per day for the last 5 days into the "test" project.
 * Usage: node scripts/seed-events.mjs
 */

import pg from "pg";
import { randomUUID } from "crypto";

const { Client } = pg;
const DB = "postgresql://postgres:postgres@localhost:5432/logger";

// ── helpers ──────────────────────────────────────────────────────────────────

const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const randFloat = () => (Math.random() * 1000).toFixed(2);

function weightedLevel() {
    const r = Math.random();
    if (r < 0.10) return "error";
    if (r < 0.20) return "warn";
    if (r < 0.75) return "info";
    return "debug";
}

// ── fixtures ─────────────────────────────────────────────────────────────────

const SOURCES = ["api", "worker", "frontend", "auth", "ingest", "cron", "ws"];
const ENVIRONMENTS = ["production", "staging", "development"];
const RELEASES = ["1.4.0", "1.4.1", "1.4.2", "1.5.0-rc.1"];
const USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0",
    "PostmanRuntime/7.37.0",
    "axios/1.6.8",
    null,
];
const IPS = [
    "203.0.113.42", "198.51.100.7", "192.0.2.15", "10.0.1.22",
    "172.16.0.5", "185.220.101.34", "91.108.4.1", "104.21.0.55",
];

const INFO_MESSAGES = [
    "Request completed successfully",
    "User session started",
    "Cache hit for key {key}",
    "Scheduled job {job} finished in {ms}ms",
    "Webhook delivered to {url}",
    "Email sent to {email}",
    "File uploaded: {filename}",
    "API key validated",
    "Rate limit check passed",
    "Database query executed in {ms}ms",
    "Background task enqueued",
    "Config reloaded",
    "Health check passed",
    "New project created",
    "Alert rule updated",
    "Pagination: page {page} of {total}",
    "Metrics snapshot captured",
    "User preferences saved",
    "Export job started",
    "Ingest batch of {n} events processed",
];

const WARN_MESSAGES = [
    "Slow query detected: {ms}ms exceeded threshold",
    "Retry {attempt}/3 for {op}",
    "Rate limit approaching: {pct}% used",
    "Deprecated API endpoint called",
    "Missing optional field: {field}",
    "Cache miss, falling back to DB",
    "JWT expiring soon for user {uid}",
    "Response time degraded: {ms}ms",
    "Queue depth high: {depth} pending jobs",
    "Disk usage at {pct}%",
];

const ERROR_MESSAGES = [
    "Unhandled exception in {handler}",
    "Database connection timeout after {ms}ms",
    "Failed to deliver webhook: {code}",
    "Invalid API key",
    "Payment processing failed: {reason}",
    "File upload rejected: size exceeds limit",
    "Authentication failed for user {uid}",
    "Third-party API returned 503",
    "Queue worker crashed",
    "Permission denied: missing scope {scope}",
];

const ERROR_TYPES = [
    "DatabaseError", "TimeoutError", "AuthenticationError",
    "ValidationError", "NetworkError", "PaymentError",
    "PermissionError", "RateLimitError", "InternalError",
];

const STACK_TRACES = [
    `Error: Database connection timeout
    at Pool.connect (/app/node_modules/pg-pool/index.js:123:15)
    at async dbQuery (/app/core/db/client.ts:45:5)
    at async EventService.insert (/app/features/events/services/events.service.ts:88:3)`,

    `AuthenticationError: Invalid or expired token
    at verifyJwt (/app/core/auth/jwt.ts:67:11)
    at middleware (/app/app/api/ingest/route.ts:18:5)`,

    `ValidationError: Missing required field "message"
    at validatePayload (/app/features/ingest/utils/validate.ts:34:9)
    at POST (/app/app/api/ingest/route.ts:28:7)`,

    `NetworkError: ECONNREFUSED 127.0.0.1:6379
    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1595:16)`,

    `RangeError: Maximum call stack size exceeded
    at flatten (/app/shared/utils/flatten.ts:12:14)
    at flatten (/app/shared/utils/flatten.ts:12:14)`,
];

// ── message generator ─────────────────────────────────────────────────────────

function generateMessage(level) {
    const templates = level === "error" ? ERROR_MESSAGES
        : level === "warn" ? WARN_MESSAGES
        : INFO_MESSAGES;

    return rand(templates)
        .replace("{key}", `cache:user:${randInt(1, 9999)}`)
        .replace("{job}", rand(["cleanup", "digest", "export", "sync"]))
        .replace("{ms}", randInt(50, 5000))
        .replace("{url}", `https://hooks.example.com/${randInt(1000, 9999)}`)
        .replace("{email}", `user${randInt(1, 999)}@example.com`)
        .replace("{filename}", `upload_${randInt(1000, 9999)}.csv`)
        .replace("{page}", randInt(1, 20))
        .replace("{total}", randInt(20, 100))
        .replace("{n}", randInt(10, 500))
        .replace("{attempt}", randInt(1, 3))
        .replace("{op}", rand(["webhook-delivery", "db-write", "api-call"]))
        .replace("{pct}", randInt(70, 95))
        .replace("{field}", rand(["source", "release", "user_id"]))
        .replace("{uid}", `u_${randInt(1000, 9999)}`)
        .replace("{depth}", randInt(100, 1000))
        .replace("{handler}", rand(["POST /api/ingest", "cron/digest", "worker/cleanup"]))
        .replace("{code}", rand(["502", "503", "504", "429"]))
        .replace("{reason}", rand(["card_declined", "insufficient_funds", "expired_card"]))
        .replace("{scope}", rand(["events:write", "alerts:manage", "api_keys:create"]))
        .replace("{op}", rand(["webhook", "payment", "export"]));
}

// ── build one event row ───────────────────────────────────────────────────────

function makeEvent(projectId, dayStart) {
    const level = weightedLevel();
    const isError = level === "error";
    const source = rand(SOURCES);
    const env = rand(ENVIRONMENTS);

    // Random time within the day
    const ts = new Date(dayStart.getTime() + randInt(0, 86399) * 1000);

    const attributes = {
        http_method: rand(["GET", "POST", "PUT", "DELETE", "PATCH"]),
        status_code: isError ? rand([500, 502, 503]) : rand([200, 201, 204]),
        duration_ms: parseFloat(randFloat()),
        path: rand(["/api/ingest", "/api/projects", "/api/events", "/api/alerts", "/dashboard"]),
    };

    const context = {
        region: rand(["eu-west-1", "us-east-1", "ap-southeast-1"]),
        pod: `pod-${randInt(1, 16)}`,
        instance: `i-${Math.random().toString(36).slice(2, 10)}`,
    };

    return {
        id: randomUUID(),
        project_id: projectId,
        timestamp: ts.toISOString(),
        level,
        message: generateMessage(level),
        source,
        environment: env,
        release: rand(RELEASES),
        user_id: Math.random() > 0.3 ? `u_${randInt(1000, 9999)}` : null,
        session_id: Math.random() > 0.4 ? `sess_${randomUUID().slice(0, 8)}` : null,
        request_id: `req_${randomUUID().slice(0, 12)}`,
        trace_id: Math.random() > 0.5 ? `trace_${randomUUID().slice(0, 16)}` : null,
        error_type: isError ? rand(ERROR_TYPES) : null,
        stack_trace: isError && Math.random() > 0.3 ? rand(STACK_TRACES) : null,
        attributes: JSON.stringify(attributes),
        context: JSON.stringify(context),
        user_agent: rand(USER_AGENTS),
        ip: Math.random() > 0.2 ? rand(IPS) : null,
    };
}

// ── main ──────────────────────────────────────────────────────────────────────

const c = new Client({ connectionString: DB });
await c.connect();

// Resolve project
const projectRes = await c.query(
    "SELECT id, name FROM projects WHERE slug = $1 OR name ILIKE $1 LIMIT 1",
    ["some"],
);
if (projectRes.rows.length === 0) {
    console.error('Project "test" not found. Check the slug/name in the projects table.');
    await c.end();
    process.exit(1);
}
const { id: projectId, name: projectName } = projectRes.rows[0];
console.log(`Seeding project "${projectName}" (${projectId})`);

// Build 5 days (today backwards)
const today = new Date("2026-05-16T00:00:00Z");
let totalInserted = 0;

for (let d = 4; d >= 0; d--) {
    const dayStart = new Date(today);
    dayStart.setUTCDate(today.getUTCDate() - d);

    const count = randInt(200, 300);
    const events = Array.from({ length: count }, () => makeEvent(projectId, dayStart));

    // Batch insert in chunks of 100
    const CHUNK = 100;
    for (let i = 0; i < events.length; i += CHUNK) {
        const chunk = events.slice(i, i + CHUNK);
        const cols = [
            "id", "project_id", "timestamp", "level", "message", "source",
            "environment", "release", "user_id", "session_id", "request_id",
            "trace_id", "error_type", "stack_trace", "attributes", "context",
            "user_agent", "ip",
        ];
        const placeholders = chunk.map(
            (_, ri) => `(${cols.map((_, ci) => `$${ri * cols.length + ci + 1}`).join(", ")})`
        ).join(", ");

        const values = chunk.flatMap((e) => cols.map((col) => e[col] ?? null));
        await c.query(
            `INSERT INTO events (${cols.join(", ")}) VALUES ${placeholders}`,
            values,
        );
    }

    totalInserted += count;
    const label = dayStart.toISOString().slice(0, 10);
    console.log(`  ${label}: ${count} events inserted`);
}

await c.end();
console.log(`\nDone. Total: ${totalInserted} events.`);
