# API

There is no OpenAPI/Swagger spec in the repo — this document is the API contract, derived directly from the route handler code. Two kinds of "API" exist in this app:

1. **Public HTTP API** under `/api/*` — the event ingestion endpoints (API-key authenticated, meant for external SDKs/services) plus operational endpoints (health, version) and the better-auth catch-all.
2. **Internal Server Actions** — everything the web UI uses to mutate data (create project, invite member, create alert rule, ...). Not HTTP-callable from outside Next.js; documented here for completeness since they're a large part of "how the app works."

## Ingest API

The primary public-facing API. Designed for SDKs/services to POST structured log events. Authenticated with a **Bearer API key** (see [security.md](security.md#api-key-security-ingest-authentication)), not cookies/sessions — so CORS is wide open (`Access-Control-Allow-Origin: *`) on these two routes specifically, which is intentional since there's no cookie-based session to leak via CSRF.

### `POST /api/ingest` — single event

```bash
curl -X POST http://localhost/api/ingest \
  -H "Authorization: Bearer lgr_YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"level":"error","message":"Something went wrong","environment":"production"}'
```

Request flow (in order — each step can short-circuit the response):
1. **Body-size guard**: `Content-Length > 64 KB` → `413 { "error": "Payload too large." }`
2. **Auth**: missing/malformed `Authorization` header, wrong key prefix, or unknown/revoked key → `401 { "error": "<reason>" }`
3. **Rate limit**: per-API-key, see [security.md](security.md#rate-limiting) → `429 { "error": "Rate limit exceeded." }` + `Retry-After: <seconds>` header
4. **JSON parse**: invalid JSON → `400 { "error": "Invalid JSON." }`
5. **Schema validation** (Zod, see [Event schema](#event-schema) below) → `400 { "error": "Validation failed.", "details": <zod fieldErrors> }`
6. **Attribute type conflict check** (see [logging.md](logging.md#attribute-type-enforcement)) → `400 { "error": "Attribute type conflict.", "details": [{index, key, message}] }`
7. **Timestamp policy** (see below) — timestamp too old → `400 { "error": "Event timestamp is older than 30-day retention window." }`
8. **Insert** → `202 { "id": "<uuid>" }` into ClickHouse — see [Where an event is written](#where-an-event-is-written) below. A failure returns `500` and is never swallowed.
9. ~~**Environment registry update**~~ — **deleted 2026-08-26.** Three derived Postgres tables were maintained after the insert — an environment registry, a message-template registry and a rollup watermark — each behind its own `try`/`catch`, and they were the only deliberately swallowed errors on this path. All three summarised a table that has moved to ClickHouse, which maintains its own aggregates. **Every error on the ingest path now propagates.**
10. Any unexpected error → logged server-side, `500 { "error": "Internal server error." }`

### `POST /api/ingest/batch` — up to 500 events

```bash
curl -X POST http://localhost/api/ingest/batch \
  -H "Authorization: Bearer lgr_YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '[{"level":"info","message":"User signed in"},{"level":"warn","message":"Slow query","attributes":{"ms":1200}}]'
```

Same auth/rate-limit/body-size gating as single ingest, but:
- Body-size limit is **5 MB** (not 64 KB), and the payload must be a **top-level JSON array**, max **500 events** (`400`/`413` accordingly).
- Rate limiting consumes **N units** (N = number of events in the array) against the same per-minute budget in one call.
- Validation and attribute-type checking are done **per event, independently** — invalid or type-conflicting events are excluded, valid ones are still inserted (partial success).
- Response:
  - All events invalid/conflicting → `400 { "accepted": 0, "errors": [...] }`
  - Some failed → `207 { "accepted": <n>, "errors": [{index, message}, ...] }`
  - All succeeded → `202 { "accepted": <n>, "errors": [] }`

> **Known wart**: per-event validation error messages in the batch endpoint are produced via `.toString()` on a Zod `fieldErrors` object, which yields the unhelpful literal string `"[object Object]"` rather than structured detail (unlike the single-event endpoint, which returns the real `fieldErrors` object). If you're building an SDK against this API, don't rely on batch error message content — only on the `index` to know which event failed.

### Event schema

Only `level` and `message` are required. Unrecognized top-level fields are silently stripped (not rejected, not passed through).

| Field | Type | Required | Constraint |
|---|---|---|---|
| `level` | enum | **yes** | one of `debug`, `info`, `warn`, `error`, `fatal` |
| `message` | string | **yes** | 1–2048 chars |
| `timestamp` | ISO 8601 string, **with timezone offset** | no | server fills with `now()` if absent; see timestamp policy below |
| `source` | string | no | max 256 |
| `environment` | string | no | max 128 |
| `release` | string | no | max 256 |
| `user_id` | string | no | max 256 — correlation ID, **not** a foreign key |
| `session_id` | string | no | max 256 |
| `request_id` | string | no | max 256 |
| `trace_id` | string | no | max 256 |
| `error_type` | string | no | max 256 |
| `stack_trace` | string | no | max 32 KB (32768 chars) |
| `attributes` | `Record<string, string\|number\|boolean\|null>` | no | flat map, primitives only (nested objects/arrays rejected), default `{}` — see [logging.md](logging.md#attribute-type-enforcement) for the type-consistency rule |
| `context` | `Record<string, unknown>` | no | free-form nested JSON, default `{}` |

**A blank optional string is treated as absent, not as a value** (changed 2026-08-26). `{"environment": ""}` and a missing `environment` produce the same stored event, and `""` no longer appears as its own entry in the filter bar beside `(unset)`. Whitespace-only counts as blank. This applies to every optional string above — not to `message`, which is the event itself and is still rejected when empty.

The reason is storage: the ClickHouse `events` table has **no `Nullable` column anywhere** (a Nullable carries a separate per-column mask and blocks optimizations), so absent is stored as the empty string and the two were about to become indistinguishable regardless. Normalising rather than rejecting is deliberate — an ingest endpoint discarding an event because a caller sent `""` for a field it never had to send is the worse failure.

Server always fills/overrides (never trusts the client for these): `id`, `project_id` (from the authenticated API key), `user_agent` and `ip` (from request headers — any client-supplied values in the body are ignored).

`id` is a **UUIDv7** since 2026-08-26, not the v4 `randomUUID()` gave. It is still an opaque unique id to any caller; the version matters because ClickHouse measured a v4 `id` column at compression ratio 1.0 and a fifth of the whole table, and v7's leading timestamp bits are near-constant inside a sorted granule.

`ip` is now validated. The first hop of `X-Forwarded-For` is stored only if it parses as an IPv4 or IPv6 address; anything else — a hostname, an address with a port, a truncated one — is stored as `::` ("not known"). The ClickHouse column is `IPv6` and rejects an unparseable value by failing the **entire insert**, which for a batch would mean 500 events lost to one malformed proxy header.

**Timestamp policy** (`sanitizeTimestamp`):
- Absent → server `now()`.
- More than **5 minutes in the future** → silently coerced to server `now()` (logged as a warning server-side, does not error).
- More than **30 days in the past** → **rejected** (`400`, matches the 30-day partition retention window — an event that old would be immediately eligible for partition drop anyway).
- Otherwise → used as provided.

### Where an event is written

An accepted event is written to **ClickHouse**, and nowhere else, since
2026-08-26 (Phase 4 of `docs/features/09-clickhouse.md`).

For two phases before that it was a **dual write** to ClickHouse and Postgres —
scaffolding with a scheduled end, so the read surfaces could move one at a time
while the whole e2e suite stayed green and both stores held identical rows to
compare. Phase 4 moved the last read and deleted the Postgres `events` table
with it.

One observable consequence disappeared with it: while both stores were written,
there was no transaction across them, so a `500` could leave the event in one
and not the other. With one store a request either stored its events or
returned an error.

ClickHouse writes use `async_insert = 1` with `wait_for_async_insert = 1`. The server buffers many small requests into properly sized parts, and the `202` is not returned until the data is durable — so an event is readable immediately after the response, and a flush error reaches the caller instead of only a server log. The cost is up to ~200 ms of latency per request; `POST /api/ingest/batch` amortizes it to ~0.4 ms per event.

### `Idempotency-Key` (optional request header)

Both ingest routes accept an `Idempotency-Key` header, 1–128 characters. When present, a repeat of the same request is discarded rather than stored twice.

```bash
curl -X POST http://localhost/api/ingest/batch   -H "Authorization: Bearer lgr_YOUR_API_KEY"   -H "Idempotency-Key: 018f3c9a-7b2e-7c3d-9e1f-2a4b6c8d0e1f"   -H "Content-Type: application/json"   -d '[{"level":"info","message":"User signed in"}]'
```

- The key is scoped to the project, so two projects using the same key do not affect each other.
- A repeat is **discarded silently** — the response is a normal `202`, not a `409`. The caller cannot distinguish "stored" from "already stored", which is the point: an SDK retrying a timeout wants the same answer either way.
- The window is the last **10,000 inserts** per month-partition. A retry seconds after the original is always covered; a repeat sent hours later, after tens of thousands of other inserts, is not.
- A key that is blank, whitespace-only, or longer than 128 characters is **ignored**, and the request behaves as if none was sent. It is never truncated, because two keys truncated to the same prefix would discard two genuinely different batches.
- Sending **different** events under a key already used discards them. The key identifies the request, not its contents.

**Without the header there is no deduplication**, which is the behaviour every existing client has. This is deliberate and not a gap to close later: the token cannot be derived from the payload, because a logging service receives byte-identical payloads constantly — a heartbeat, a retry loop, the same error twice in a second — and content-based deduplication would store one of them and report success for both. Only the caller knows whether a request is new or a repeat.

Header names are case-insensitive, and `Idempotency-Key` is listed in `Access-Control-Allow-Headers` on both routes so a browser can send it cross-origin.

### Response codes (both ingest routes)

| Code | Meaning |
|---|---|
| 202 | Accepted |
| 207 | Batch only — partial success (some events failed validation/type-check) |
| 400 | Validation error, attribute type conflict, or timestamp outside retention window |
| 401 | Missing/malformed/invalid/revoked API key |
| 413 | Payload too large (single: 64 KB; batch: 5 MB or >500 events) |
| 429 | Rate limit exceeded (`Retry-After` header present) |
| 500 | Internal server error |

`OPTIONS` is supported on both routes for CORS preflight, returning `204`.

## Operational endpoints

### `GET /api/health`

No auth. Trivial liveness probe — always `200`:
```json
{ "status": "ok", "uptime": 12345.6, "version": "0.1.0" }
```

### `GET /api/health/ready`

No auth. Real readiness probe, checks four things and returns `200` (all healthy) or **`503`**:

```json
{ "status": "ok", "checks": { "db": "ok", "pgboss": "ok", "ingest": "ok", "clickhouse": "ok" } }
```

| Check | How | Failure behavior |
|---|---|---|
| `db` | `SELECT 1` | fails health (503) on error |
| `pgboss` | queries `pgboss.version` if the in-process worker is running; else reports `not_running_in_process` | `not_running_in_process` does **not** fail health |
| `ingest` | any ClickHouse `events` row with `timestamp > now() - 1h`? | `"stale"` if none — **warning only**, adds an `X-Health-Warn` response header, does **not** fail health |
| `clickhouse` | `clickhouse.ping({ select: true })` | fails health (503) on error |

> **The `ingest` check asks ClickHouse since 2026-08-26** (Phase 4), where it asked Postgres before. It stays a *warning*: an install with no traffic in the last hour is idle, not broken, and failing readiness for it would pull the app out of the load balancer for being quiet.

> **Replaced the `migrations` check, 2026-08-26.** It compared the applied count in `drizzle."__drizzle_migrations"` against the shipped journal. There are no migrations any more (see [architecture.md](architecture.md#schema-and-the-bootstrap)), and nothing equivalent replaces it: the schema is applied from empty by the one-shot `bootstrap` container, which compose gates `app` on with `condition: service_completed_successfully`, so an app that is serving at all has already had it succeed. The check the deleted one performed has moved from a runtime probe into the boot order.
>
> `clickhouse` is fatal rather than a warning for the same reason `db` is: from Phase 2 of `docs/features/09-clickhouse.md` on, an unreachable ClickHouse means ingest drops events and every event view is empty. Verified 2026-08-26 by stopping the container — the endpoint returns 503 with `"clickhouse": "error"`.
>
> **`select: true` is load-bearing.** On Node the default `ping()` hits the built-in `/ping` endpoint, which — per `@clickhouse/client`'s own doc comment — *does not verify credentials*. A wrong `CLICKHOUSE_PASSWORD` or a missing database would pass it while every real query failed. `select: true` issues a real `SELECT`, so the server authenticates and resolves the database. Found while writing the test for this function, and it is the same shape as the `migrations` defect above: a check that reports healthy for a reason unrelated to what it was asked. Note also that `ping()` **does not throw** — it returns `{ success: false, error }`, so a bare `await client.ping()` is a healthcheck that can never fail.

Use this endpoint (not `/api/health`) as your container's readiness/liveness probe. The production compose stack does exactly that for `app`.

### `GET /api/version`

No auth.
```json
{ "sha": "abc1234", "builtAt": "2026-05-09T12:00:00.000Z", "nodeVersion": "v22.0.0", "nextVersion": "16.2.4" }
```
`sha`/`builtAt` come from `NEXT_PUBLIC_BUILD_SHA`/`NEXT_PUBLIC_BUILD_TIME`, inlined by `next build` and passed as Docker build args by `release.yml`. `sha` falls back to `"dev"` and `builtAt` to `null`.

> **Fixed 2026-08-13.** The fallbacks used `??`, which only catches `undefined`. The Dockerfile declares `ARG NEXT_PUBLIC_BUILD_SHA=""`, so a build without `--build-arg` inlines an *empty string* — and the endpoint reported `"sha": ""` rather than `"dev"`. Now `||`, which covers both.

### `POST/GET/PUT/PATCH/DELETE /api/auth/[...all]`

Delegated entirely to better-auth (`toNextJsHandler(auth)`). Covers sign-in, sign-up (used internally only by the setup wizard and invitation-acceptance flow — there's no public self-serve sign-up form), sign-out, session retrieval, password reset request/confirm, etc. Governed by `core/auth/config.ts` — see [security.md](security.md#authentication).

## Server Actions (internal, UI-facing)

Not part of the public HTTP API, but this is "how the API works" for the web app itself. **33** action files across **7** features (`alerts`, `api-keys`, `auth`, `events`, `organizations`, `projects`, `roles`) — recounted 2026-08-26; `features/events` was missing from this list. Its single action, `get-facet-counts.action.ts`, is also the only **read** among the 33 — a deliberate departure from `PROJECT.md` §8, argued in the file itself: the read is triggered by a client interaction the server cannot see, and a route handler would mean re-implementing session auth and permission checks that an action gets for free. All follow one uniform pattern — see [architecture.md](architecture.md#server-actions-pattern) for the exact code shape. In short: Zod-validate input → require an authenticated user → look up the org by slug → check `getMembership()` against the relevant permission (`assertPermission`/`assertOwner`) → perform the DB mutation via a service function → `revalidatePath()` → return `{ ...success }` or `{ error: string }` (never throws to the caller).

Representative examples:
- `create-api-key.action.ts` — requires `api_keys.manage`, returns the plaintext key **once**.
- `invite-member.action.ts` — requires `members.invite`, generates a 7-day invite token, returns a copy-link URL (no email is sent).
- `create-role.action.ts` — **owner-only** (`roles.manage` is never assignable to a role).
- `create-project.action.ts` — requires `projects.create`, handles the Postgres `23505` unique-violation code for duplicate slugs with a friendly message.

See [users-roles.md](users-roles.md) for the full permission catalogue these actions gate against.
