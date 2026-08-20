/**
 * Shared event generation for the ingest load scripts
 * (`events-batch-by-key.mjs` and `event-one-by-key.mjs`).
 *
 * Nothing here performs I/O — it builds event objects and parses response
 * headers, so it is safe to import from a test.
 */

// ── fixtures ─────────────────────────────────────────────────────────────────

/** Level distribution. Weights are relative and need not sum to exactly 1. */
export const LEVELS = [
    ["info", 0.72],
    ["warn", 0.12],
    ["debug", 0.09],
    ["error", 0.05],
    ["fatal", 0.02],
];

/**
 * Message templates, deliberately spread across three cardinality classes.
 *
 * This matters for measurement, not for realism alone. The dashboard's "Top
 * messages" widget runs `GROUP BY SUBSTRING(message, 1, 200)`, and the cost of
 * that hash aggregate scales with the number of **distinct** messages, not the
 * number of rows. An earlier version of this file used twelve fixed strings;
 * an `EXPLAIN ANALYZE` against 195k events then reported 275 groups and 77 kB
 * of hash memory, which said nothing at all about how the query behaves on
 * real traffic. A mix of repeating and near-unique messages is what production
 * actually looks like, and it is what puts `work_mem` under honest pressure.
 */
export const MESSAGE_TEMPLATES = [
    // Verbatim repeats — the case "Top messages" exists to surface.
    "Health check passed",
    "Configuration reloaded",
    "Scheduled job completed",
    // Bounded cardinality — one token drawn from a small set.
    "Request served for {route}",
    "Cache miss for {route}",
    "Rate limit applied on {route}",
    // Effectively unique per event.
    "User {user} signed in",
    "Payment {id} authorized in {ms}ms",
    "Session {key} expired",
    "Slow query detected: {ms}ms on {route}",
    "Upload finished for {user}: {bytes} bytes",
    "Webhook delivery to {host} failed after {ms}ms",
];

/** Substitutions available inside a message template. */
const MESSAGE_TOKENS = {
    route: (random) => pick(ROUTES, random),
    user: (random) => `u_${Math.floor(random() * 5000)}`,
    id: (random) => Math.floor(random() * 0xffffffff).toString(16).padStart(8, "0"),
    key: (random) => `sess_${Math.floor(random() * 1e9).toString(36)}`,
    ms: (random) => String(Math.floor(random() * 5000) + 1),
    bytes: (random) => String(Math.floor(random() * 4_000_000) + 512),
    host: (random) => pick(["hooks.example.com", "api.partner.io", "relay.internal.net"], random),
};

export const SOURCES = ["api", "worker", "web", "cron", "mobile"];
export const ENVIRONMENTS = ["production", "staging"];
export const ROUTES = ["/checkout", "/login", "/api/ingest", "/dashboard", "/team", "/events", "/settings"];

// ── helpers ──────────────────────────────────────────────────────────────────

export function pick(arr, random = Math.random) {
    return arr[Math.floor(random() * arr.length)];
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Pick a level according to the weights in LEVELS. */
export function weightedLevel(random = Math.random) {
    let r = random();
    for (const [level, weight] of LEVELS) {
        if (r < weight) return level;
        r -= weight;
    }
    return LEVELS[0][0];
}

/**
 * Replace each attribute value with a random one of the *same* type.
 *
 * This is the property that keeps a long run alive: the project's attribute
 * type registry records that `latency_ms` is a number the first time it sees
 * one, and rejects a string for that key ever after with a 400.
 */
export function randomizeAttributes(attributes, random = Math.random) {
    const out = {};
    for (const [key, value] of Object.entries(attributes ?? {})) {
        if (typeof value === "number") {
            out[key] = Math.floor(random() * 3000) + 1;
        } else if (typeof value === "boolean") {
            out[key] = random() < 0.5;
        } else if (typeof value === "string") {
            out[key] = key === "route" ? pick(ROUTES, random) : value;
        } else {
            out[key] = value;
        }
    }
    return out;
}

/**
 * Pick a message template and fill its tokens. An unknown token is left as-is
 * rather than swallowed, so a typo in a template shows up in the data instead
 * of disappearing silently.
 */
export function buildMessage(random = Math.random) {
    const template = pick(MESSAGE_TEMPLATES, random);
    return template.replace(/\{(\w+)\}/g, (whole, token) => {
        const fill = MESSAGE_TOKENS[token];
        return fill ? fill(random) : whole;
    });
}

/** Build one event from a template. Returns a fresh object every call. */
export function buildEvent(template, randomize = true, random = Math.random) {
    if (!randomize) return structuredClone(template);
    return {
        ...structuredClone(template),
        level: weightedLevel(random),
        message: buildMessage(random),
        source: pick(SOURCES, random),
        environment: pick(ENVIRONMENTS, random),
        trace_id: `t_${Math.floor(random() * 1e12).toString(36)}`,
        user_id: `u_${Math.floor(random() * 500)}`,
        attributes: randomizeAttributes(template.attributes, random),
    };
}

/**
 * Backoff for a 429, in milliseconds. `Retry-After` is seconds per RFC 9110;
 * anything missing or unparseable falls back to `fallbackMs`. The HTTP-date
 * form of the header is deliberately not supported — this API only ever sends
 * the seconds form.
 */
export function parseRetryAfterMs(headerValue, fallbackMs = 60_000) {
    if (headerValue == null) return fallbackMs;
    const seconds = Number(String(headerValue).trim());
    if (!Number.isFinite(seconds) || seconds < 0) return fallbackMs;
    return Math.round(seconds * 1000);
}
