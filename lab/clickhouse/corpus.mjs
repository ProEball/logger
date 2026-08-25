/**
 * Corpus generation for the Phase 0 ClickHouse experiments
 * (`docs/features/09-clickhouse.md` §13).
 *
 * Nothing here performs I/O — it builds row objects, so it is safe to import
 * from a test. `seed.mjs` does the inserting.
 *
 * **Why this file has tests when it is throwaway lab code.** Every number the
 * lab produces is a statement about this corpus. If the corpus does not have
 * the properties the experiments assume — disjoint attribute keys per project,
 * three template cardinality classes, traces that actually group — then the
 * measurements are answering a different question than the one asked, and
 * nothing about the output would reveal it. That is the same failure as
 * `aggregations.service.test.ts` naming a service it never imported: green,
 * confident, and about nothing.
 */

// ── deterministic RNG ────────────────────────────────────────────────────────

/**
 * mulberry32. Seeded so two runs of the lab compare against the same corpus —
 * `Math.random()` would make "candidate B read fewer rows" unfalsifiable.
 */
export function mulberry32(seed) {
    let a = seed >>> 0;
    return function random() {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function pick(arr, random) {
    return arr[Math.floor(random() * arr.length)];
}

// ── fixtures ─────────────────────────────────────────────────────────────────

export const LEVELS = [
    ["info", 0.72],
    ["warn", 0.12],
    ["debug", 0.09],
    ["error", 0.05],
    ["fatal", 0.02],
];

export const ENVIRONMENTS = ["production", "staging", "dev"];
export const SOURCES = ["api", "worker", "web", "cron", "mobile"];
export const ROUTES = ["/checkout", "/login", "/api/ingest", "/dashboard", "/team", "/events", "/settings"];
export const ERROR_TYPES = ["", "", "", "TimeoutError", "ValidationError", "UpstreamError", "AuthError"];

/**
 * Three cardinality classes, following `scripts/event-factory.mjs`.
 *
 * The class mix is the point. `topMessages` costs scale with the number of
 * *distinct* messages, not rows, and a corpus of twelve fixed strings measures
 * nothing. `{tok}` markers are filled per event; a template with no marker
 * repeats verbatim.
 */
export const TEMPLATES = {
    // Repeat verbatim — the case a "top messages" widget exists to surface.
    verbatim: [
        "Health check passed",
        "Configuration reloaded",
        "Scheduled job completed",
        "Connection pool refreshed",
    ],
    // Bounded — one token drawn from a small set.
    bounded: [
        "Request served for {route}",
        "Cache miss for {route}",
        "Rate limit applied on {route}",
    ],
    // Effectively unique per event.
    unique: [
        "User {user} signed in",
        "Payment {id} authorized in {ms}ms",
        "Session {key} expired",
        "Slow query detected: {ms}ms on {route}",
        "Webhook delivery to {host} failed after {ms}ms",
    ],
};

/** Relative weights for the three classes. Sums to 1. */
export const TEMPLATE_CLASS_WEIGHTS = [
    ["verbatim", 0.45],
    ["bounded", 0.35],
    ["unique", 0.2],
];

const TOKENS = {
    route: (r) => pick(ROUTES, r),
    user: (r) => `u_${Math.floor(r() * 5000)}`,
    id: (r) => Math.floor(r() * 0xffffffff).toString(16).padStart(8, "0"),
    key: (r) => `sess_${Math.floor(r() * 1e9).toString(36)}`,
    ms: (r) => String(Math.floor(r() * 5000) + 1),
    host: (r) => pick(["hooks.example.com", "api.partner.io", "relay.internal.net"], r),
};

/**
 * Per-project attribute shapes, **pairwise disjoint on purpose** (requirement
 * R2 in the plan doc).
 *
 * Disjointness is what makes experiment 4 attributable: `GROUP BY
 * attributes.order_id` touches exactly one project's data, so a measurement of
 * it is a measurement of subcolumn access rather than of how many projects
 * happen to share a key name. Real installs are messier, but a messier corpus
 * would blur the one thing the experiment is for.
 *
 * Types mirror what `attribute_key_types` enforces at ingest: one type per
 * (project, key), forever.
 */
/**
 * **Widened from 3 keys to 18 on 2026-08-26**, and the width is the experiment.
 *
 * The first run measured a JSON subcolumn at only 15% cheaper than a `Map` and
 * could not tell whether the claim in plan §4.3 was wrong or the corpus was too
 * thin to test it. A `Map` pays for *every* key in the row to read one, so at
 * three keys there is almost nothing to skip past — the measurement was of a
 * case that does not occur. Real projects carry ten to thirty.
 *
 * `ATTRIBUTES_PER_PROJECT` is asserted by the tests, so this cannot quietly
 * drift back to a width that answers nothing.
 */
export const ATTRIBUTES_PER_PROJECT = 18;

const S = "string", N = "number", B = "boolean";

export const PROJECT_ATTRIBUTES = [
    // 0 — checkout
    { order_id: S, cart_total: N, is_guest: B, coupon_code: S, currency: S, payment_method: S,
      line_items: N, shipping_cents: N, tax_cents: N, discount_cents: N, gift_wrap: B, express: B,
      warehouse: S, carrier: S, fraud_score: N, retry_of: S, address_verified: B, basket_age_s: N },
    // 1 — saas control plane
    { tenant_tier: S, seat_count: N, trial: B, workspace_slug: S, sso_provider: S, mfa_kind: S,
      api_calls: N, storage_mb: N, members: N, invites_pending: N, suspended: B, byo_domain: B,
      billing_country: S, contract_type: S, days_to_renewal: N, owner_role: S, sandbox: B, quota_pct: N },
    // 2 — mobile client
    { device_model: S, battery_pct: N, rooted: B, os_version: S, app_build: S, network_kind: S,
      free_disk_mb: N, memory_mb: N, screen_dp: N, cold_start_ms: N, low_power: B, background: B,
      locale: S, push_token_kind: S, frames_dropped: N, gpu: S, offline_queue: B, fps: N },
    // 3 — job queue
    { queue_name: S, attempt_no: N, dead_lettered: B, handler: S, priority_band: S, producer: S,
      payload_bytes: N, lag_ms: N, duration_ms: N, prefetch: N, idempotent: B, scheduled: B,
      partition_key: S, worker_pool: S, retries_left: N, lock_owner: S, poisoned: B, batch_size: N },
    // 4 — content feed
    { feed_slug: S, item_count: N, partial: B, ranker: S, surface: S, dedupe_key: S,
      candidates: N, render_ms: N, cursor_depth: N, blocked_items: N, personalised: B, cold_user: B,
      variant: S, publisher: S, freshness_s: N, fallback_reason: S, cache_hit: B, score_p50: N },
    // 5 — edge / cdn
    { region_code: S, latency_ms: N, cached: B, pop: S, tls_version: S, http_version: S,
      bytes_out: N, bytes_in: N, ttfb_ms: N, hops: N, compressed: B, revalidated: B,
      origin: S, cache_key_class: S, age_s: N, waf_rule: S, blocked: B, upstream_ms: N },
    // 6 — billing
    { plan_code: S, invoice_cents: N, proration: B, processor: S, invoice_state: S, dunning_stage: S,
      line_count: N, credits_cents: N, refund_cents: N, attempt: N, past_due: B, auto_collect: B,
      tax_region: S, coupon_kind: S, cycle_day: N, decline_code: S, revenue_recognised: B, mrr_delta: N },
    // 7 — datastore
    { shard_key: S, replica_lag_ms: N, read_only: B, node: S, statement_kind: S, isolation: S,
      rows_examined: N, rows_returned: N, plan_cost: N, connections: N, from_cache: B, in_txn: B,
      index_used: S, lock_kind: S, temp_bytes: N, error_class: S, failover: B, buffer_hit_pct: N },
    // 8 — ads
    { campaign_id: S, impressions: N, throttled: B, placement: S, creative_kind: S, bidder: S,
      clicks: N, bid_micros: N, floor_micros: N, viewable_ms: N, brand_safe: B, capped: B,
      audience: S, device_class: S, win_rate_pct: N, reject_reason: S, house_ad: B, spend_micros: N },
    // 9 — document pipeline
    { doc_type: S, page_count: N, ocr_used: B, mime: S, stage: S, extractor: S,
      bytes: N, chars: N, tables_found: N, confidence_pct: N, encrypted: B, redacted: B,
      language: S, source_system: S, queue_wait_s: N, failure_stage: S, resumed: B, dpi: N },
];

/**
 * Project share of total volume, descending.
 *
 * Uniform projects would be the friendliest possible case for a key led by
 * `project_id`: every granule would hold one project either way. Real installs
 * are skewed, and the skew is what makes granule locality worth measuring.
 */
export const PROJECT_WEIGHTS = [0.34, 0.19, 0.12, 0.09, 0.07, 0.06, 0.05, 0.04, 0.03, 0.01];

/** Stable, readable project ids. `p` + index, padded into a UUID shape. */
export function projectId(index) {
    const hex = index.toString(16).padStart(12, "0");
    return `00000000-0000-4000-8000-${hex}`;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function weighted(pairs, random) {
    let r = random();
    for (const [value, weight] of pairs) {
        if (r < weight) return value;
        r -= weight;
    }
    return pairs[0][0];
}

export function weightedLevel(random) {
    return weighted(LEVELS, random);
}

export function weightedProject(random, projectCount) {
    const pairs = PROJECT_WEIGHTS.slice(0, projectCount).map((w, i) => [i, w]);
    // Renormalise: a truncated weight list would bias toward index 0.
    const total = pairs.reduce((s, [, w]) => s + w, 0);
    return weighted(pairs.map(([i, w]) => [i, w / total]), random);
}

/** FNV-1a, 32-bit. Stands in for `templateHashForStorage` — same job, no import. */
export function fnv1a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h;
}

/**
 * Returns the rendered message **and the template it came from**.
 *
 * Both, not just the message, because `template_hash` has to be the
 * fingerprint of the template — that is the whole premise of experiment 5
 * ("distinct templates per hour") and of the `events_by_template` sizing that
 * depends on it. A random hash per row would make every event its own
 * template, and the experiment would report the row count while looking like
 * it had measured something.
 */
export function buildMessage(random) {
    const klass = weighted(TEMPLATE_CLASS_WEIGHTS, random);
    const template = pick(TEMPLATES[klass], random);
    const message = template.replace(/\{(\w+)\}/g, (whole, token) =>
        TOKENS[token] ? TOKENS[token](random) : whole,
    );
    return { message, template };
}

/** Attribute bag for a project, values randomised but types fixed per key. */
export function buildAttributes(projectIndex, random) {
    const schema = PROJECT_ATTRIBUTES[projectIndex % PROJECT_ATTRIBUTES.length];
    const out = {};
    for (const [key, type] of Object.entries(schema)) {
        if (type === "number") out[key] = Math.floor(random() * 5000) + 1;
        else if (type === "boolean") out[key] = random() < 0.35;
        else out[key] = `${key.slice(0, 3)}_${Math.floor(random() * 900) + 100}`;
    }
    return out;
}

/** `YYYY-MM-DD HH:MM:SS.mmm` — the shape DateTime64(3) accepts in JSONEachRow. */
export function formatTimestamp(ms) {
    return new Date(ms).toISOString().replace("T", " ").replace("Z", "");
}

function uuidFrom(random) {
    const hex = "0123456789abcdef";
    let out = "";
    for (let i = 0; i < 32; i++) out += hex[Math.floor(random() * 16)];
    return `${out.slice(0, 8)}-${out.slice(8, 12)}-4${out.slice(13, 16)}-8${out.slice(17, 20)}-${out.slice(20, 32)}`;
}

// ── generation ───────────────────────────────────────────────────────────────

export const DEFAULTS = {
    rows: 5_000_000,
    projects: 10,
    days: 30,
    seed: 20260826,
    /** Events sharing one trace id. Traces are contiguous in time by construction. */
    traceSize: 8,
};

/**
 * Yields corpus rows in **timestamp order**, oldest first.
 *
 * Time order matters for more than realism: it is what the `Delta` codec on
 * `timestamp` and the leading bits of a v7-style id rely on, and inserting
 * out of order would make the compression numbers from experiment 3 pessimistic
 * in a way production would not be.
 */
export function* generateCorpus(options = {}) {
    const { rows, projects, days, seed, traceSize } = { ...DEFAULTS, ...options };
    const random = mulberry32(seed);

    const endMs = Date.UTC(2026, 7, 26, 0, 0, 0);
    const startMs = endMs - days * 86_400_000;
    const stepMs = (endMs - startMs) / rows;

    // Releases rotate roughly daily, which is what makes `release` the
    // dimension the plan doc refuses to put in a rollup key.
    const releaseFor = (ms) => `v1.${Math.floor((ms - startMs) / 86_400_000)}.0`;

    const NAMED_ERRORS = ERROR_TYPES.filter(Boolean);

    let traceProject = 0;
    let traceId = "";
    let traceRemaining = 0;

    for (let i = 0; i < rows; i++) {
        if (traceRemaining === 0) {
            traceProject = weightedProject(random, projects);
            traceId = uuidFrom(random);
            traceRemaining = 1 + Math.floor(random() * (traceSize * 2 - 1));
        }
        traceRemaining--;

        const ts = startMs + i * stepMs;
        const level = weightedLevel(random);
        const isError = level === "error" || level === "fatal";
        const { message, template } = buildMessage(random);

        // One bag, three renderings of it. The Map columns exist only so
        // experiment 4 can compare `attributes.k` against `attr_str['k']` on
        // identical data — drawing them independently would compare two
        // different corpora and call the difference a storage property.
        const attributes = buildAttributes(traceProject, random);
        const attrEntries = Object.entries(attributes);

        yield {
            project_id: projectId(traceProject),
            timestamp: formatTimestamp(ts),
            id: uuidFrom(random),
            level,
            message,
            source: pick(SOURCES, random),
            environment: pick(ENVIRONMENTS, random),
            release: releaseFor(ts),
            error_type: isError ? pick(NAMED_ERRORS, random) : "",
            user_id: `u_${Math.floor(random() * 20000)}`,
            session_id: `s_${Math.floor(random() * 60000).toString(36)}`,
            request_id: uuidFrom(random),
            trace_id: traceId,
            template_hash: fnv1a(template),
            attributes,
            attr_str: Object.fromEntries(attrEntries.filter(([, v]) => typeof v === "string")),
            attr_num: Object.fromEntries(attrEntries.filter(([, v]) => typeof v === "number")),
            context: JSON.stringify({ route: pick(ROUTES, random), attempt: 1 }),
            stack_trace: isError ? `Error: boom\n    at handler (/app/${pick(ROUTES, random)}:12:9)`.repeat(6) : "",
            user_agent: pick(
                ["logger-sdk/1.4.2", "logger-sdk/1.5.0", "curl/8.4.0", "Mozilla/5.0 (X11; Linux x86_64)"],
                random,
            ),
            ip: `10.${Math.floor(random() * 256)}.${Math.floor(random() * 256)}.${Math.floor(random() * 256)}`,
            retention_days: 30,
        };
    }
}
