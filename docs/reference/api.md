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
8. **Insert** → `202 { "id": "<uuid>" }`
9. Any unexpected error → logged server-side, `500 { "error": "Internal server error." }`

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

Server always fills/overrides (never trusts the client for these): `id` (random UUID), `project_id` (from the authenticated API key), `user_agent` and `ip` (from request headers — any client-supplied values in the body are ignored).

**Timestamp policy** (`sanitizeTimestamp`):
- Absent → server `now()`.
- More than **5 minutes in the future** → silently coerced to server `now()` (logged as a warning server-side, does not error).
- More than **30 days in the past** → **rejected** (`400`, matches the 30-day partition retention window — an event that old would be immediately eligible for partition drop anyway).
- Otherwise → used as provided.

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
{ "status": "ok", "checks": { "db": "ok", "pgboss": "ok", "ingest": "ok", "migrations": "ok" } }
```

| Check | How | Failure behavior |
|---|---|---|
| `db` | `SELECT 1` | fails health (503) on error |
| `pgboss` | queries `pgboss.version` if the in-process worker is running; else reports `not_running_in_process` | `not_running_in_process` does **not** fail health |
| `ingest` | any `events` row with `timestamp > now() - 1h`? | `"stale"` if none — **warning only**, adds an `X-Health-Warn` response header, does **not** fail health |
| `migrations` | compares applied migration count (`__drizzle_migrations`) against the count of entries in `core/db/migrations/meta/_journal.json` | behind → fails health (503) — usually indicates a failed/incomplete deploy |

Use this endpoint (not `/api/health`) as your container's readiness/liveness probe.

### `GET /api/version`

No auth.
```json
{ "sha": "abc1234", "builtAt": "2026-05-09T12:00:00.000Z", "nodeVersion": "v22.0.0", "nextVersion": "16.2.4" }
```
`sha`/`builtAt` come from `NEXT_PUBLIC_BUILD_SHA`/`NEXT_PUBLIC_BUILD_TIME`, set by CI at build time (`sha` falls back to `"dev"` if unset).

### `POST/GET/PUT/PATCH/DELETE /api/auth/[...all]`

Delegated entirely to better-auth (`toNextJsHandler(auth)`). Covers sign-in, sign-up (used internally only by the setup wizard and invitation-acceptance flow — there's no public self-serve sign-up form), sign-out, session retrieval, password reset request/confirm, etc. Governed by `core/auth/config.ts` — see [security.md](security.md#authentication).

## Server Actions (internal, UI-facing)

Not part of the public HTTP API, but this is "how the API works" for the web app itself. 31 action files across 6 features (`alerts`, `api-keys`, `auth`, `organizations`, `projects`, `roles`), all following one uniform pattern — see [architecture.md](architecture.md#server-actions-pattern) for the exact code shape. In short: Zod-validate input → require an authenticated user → look up the org by slug → check `getMembership()` against the relevant permission (`assertPermission`/`assertOwner`) → perform the DB mutation via a service function → `revalidatePath()` → return `{ ...success }` or `{ error: string }` (never throws to the caller).

Representative examples:
- `create-api-key.action.ts` — requires `api_keys.manage`, returns the plaintext key **once**.
- `invite-member.action.ts` — requires `members.invite`, generates a 7-day invite token, returns a copy-link URL (no email is sent).
- `create-role.action.ts` — **owner-only** (`roles.manage` is never assignable to a role).
- `create-project.action.ts` — requires `projects.create`, handles the Postgres `23505` unique-violation code for duplicate slugs with a friendly message.

See [users-roles.md](users-roles.md) for the full permission catalogue these actions gate against.
