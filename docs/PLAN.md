# Logger — Project Plan

> Status: **Planning phase**. Nothing implemented yet.
> Last updated: 2026-05-01

This document captures all decisions and open items from the planning sessions.
Read top-to-bottom on first visit; later use it as a reference.

---

## 1. Product Summary

A self-hosted logging/event collection service. Multiple projects ship JSON events
(logs, errors, stack traces, user-agent, etc.) to a central endpoint. Users browse,
filter, dashboard, and get alerts on those events.

- **Audience**: internal use (no billing now, but architecture must allow Stripe later).
- **Multi-tenancy**: organization → projects → events. Users belong to organizations
  with roles. Sign-up is invite-only (open registration may come later).

---

## 2. Decisions Locked In

### Scale & retention
- **Volume**: up to ~1M events/day total.
- **Retention**: 30 days (rolling).
- **Real-time**: NOT needed. Manual refresh + optional client polling (off / 10s / 30s / 60s).

### Stack

| Layer | Choice | Rationale |
|---|---|---|
| Framework | Next.js 16 (App Router) | Fixed |
| Language | TypeScript (strict) | Project rule |
| Database | **PostgreSQL 16** | 1M/day fits comfortably. ClickHouse is overkill below ~10M/day. |
| Partitioning | **pg_partman** | Daily partitions, auto-drop after 30 days |
| ORM | **Drizzle** | Typed, lightweight, good migrations |
| Auth | **better-auth** | Modern, RBAC-friendly, TS-first |
| Background jobs | **pg-boss** | Queue on top of Postgres — no Redis needed initially |
| Notifications | **Webhook (MVP)** + provider abstraction | Email/SMS pluggable later via same interface |
| Reverse proxy | **Caddy** | Auto TLS, single domain, minimal config |
| Logging | **pino** → stdout | Picked up by Docker; no shipper in MVP |
| Backups | `pg_dump -Fc` nightly + rclone offsite | Sufficient for projected DB size |
| Charts | **Recharts** | Sufficient for dashboards |
| Validation | **Zod** | Everywhere: ingest, forms, server actions |
| Forms | **gform-react** | Project rule |
| Styling | **SCSS modules** | Project rule |
| State (global) | **Redux Toolkit** | Project rule (user, theme, lang) |
| Hosting | **Self-hosted Docker** | docker-compose with app + Postgres |

### Deferred / not now
- ClickHouse, Redis, Elasticsearch — not needed at current scale.
- SDK client libraries — projects will POST raw JSON via API key.
- Stripe billing — abstracted but not implemented.
- Error grouping / fingerprinting (Sentry-style issues) — out of MVP.
- Real-time live-tail (SSE / WebSockets) — not needed.
- OAuth providers — not now.
- Spike / anomaly alerts — only threshold alerts in MVP.

---

## 3. Resolved Questions

Global questions resolved on 2026-04-29. Feature-level questions resolved as
features are detailed.

### Global

| # | Question | Resolution |
|---|---|---|
| Q1 | Concrete filter set on events page | See §10 |
| Q2 | Notification channel for MVP | Webhook only (incl. Slack incoming hooks). Email/SMS stubbed via same interface, deferred. See §13 |
| Q3 | Backup strategy | `pg_dump -Fc` nightly + offsite via rclone. Retention 7d + 4w. pgBackRest only if DB > 50 GB. See §15.2 |
| Q4 | Reverse proxy / TLS | Caddy in compose. Auto Let's Encrypt. See §15.1 |
| Q5 | Telemetry / health | `/api/health` + `/api/health/ready` + pino logs to stdout. Prometheus deferred. See §15.3 |

### Cross-cutting (resolved 2026-04-30)

These affect multiple features. Closed up-front to avoid rework.

| # | Question | Resolution |
|---|---|---|
| CC1 | Theme switching | Three options in UserMenu: **dark / light / system**. Default `dark`. Persisted in `users.preferences` jsonb. Anonymous users use system preference. CSS via `[data-theme]` attribute on `<html>`. No-flash inline script in `app/layout.tsx`. |
| CC2 | i18n | English only in MVP. ALL UI strings live in `core/i18n/dictionary.ts` from day one (typed, nested, accessed via `t('key')`). Multi-lang switch later = mechanical: import alternative dictionaries, add lang switcher. |
| CC3 | Time zones | DB stores `timestamptz` (UTC). UI formats with `Intl.DateTimeFormat` in browser's local TZ. UTC value shown in tooltip for shareability. |
| CC4 | Audit log | None in MVP. pino structured logs to stdout cover action traceability for internal use (e.g. `logger.info({ actor, action, target }, 'role.deleted')`). |
| CC5 | Rate limiting | better-auth handles login/register. Custom middleware on `/api/ingest` (detail in feature 03). No rate limit on internal server actions. |
| CC6 | CORS on `/api/ingest` | Allow-all (`Access-Control-Allow-Origin: *`). API key is the auth boundary. |
| —   | Onboarding tour | Not in MVP. Empty states + CTAs are sufficient; docs come later. |

### Feature 01 — Auth + Organizations + Roles (resolved 2026-04-30)

| # | Question | Resolution |
|---|---|---|
| Q-A1 | Email verification on registration? | No in MVP. Invite acts as verification. |
| Q-A2 | 2FA / TOTP? | No in MVP. |
| Q-A3 | Session length? | 30 days, rolling expiration. |
| Q-A4 | "Remember me" toggle? | No. Single rolling-30d session model. |
| Q-A5 | Bootstrap of first owner? | Setup wizard at `/setup`, active only when `users` is empty. |
| Q-A6 | Invitation delivery? | Copy-link from UI in MVP. Webhook hookup later. |

Full feature 01 plan: [docs/features/01-auth-organizations-roles.md](features/01-auth-organizations-roles.md).

### Feature 02 — Projects + API keys (resolved 2026-04-30)

| # | Question | Resolution |
|---|---|---|
| Q-B1 | API key format | `lgr_<base64url(32 bytes)>` |
| Q-B2 | Storage | SHA-256 hex hash + `key_prefix` for UI |
| Q-B3 | Reveal | Show once, no re-reveal |
| Q-B4 | Per-project member overrides | Removed from MVP; schema stub kept |
| Q-B5 | Slug uniqueness | Per-org |
| Q-B6 | Project deletion | Soft delete, no auto-purge |
| Q-B7 | Per-project retention | Column exists, not editable in MVP |
| Q-B8 | Create permission | `projects.create` (existing) |
| Q-B9 | Slug input | Auto from name, editable |
| Q-B10 | Hard limits | None in MVP |

Full feature 02 plan: [docs/features/02-projects-api-keys.md](features/02-projects-api-keys.md).

### Feature 03 — Ingest (resolved 2026-04-30)

| # | Question | Resolution |
|---|---|---|
| Q-C1 | Event schema | Hybrid: fixed common fields + flat `attributes` map + free `context` JSON |
| Q-C2 | Required fields | Only `level` + `message`. Server enriches the rest. |
| Q-C3 | pg_partman | Daily partitions, 30d retention, premake 7, hourly maintenance via pg-boss. Custom Postgres image with partman extension. |
| Q-C4 | Batch size | 500 events / 5 MB body |
| Q-C5 | Rate limit | In-memory rolling window 1000/60s per API key |
| Q-C6 | Response codes | 202 single, 202/207/400 batch, 401/413/429 errors |
| Q-C7 | Timestamp | Client-provided + sanity guards (±5min future, -30d past) |
| Q-C8 | Abuse | 64KB single, 5MB batch, 32KB stack trace |
| Q-C9 | Sync vs queued | Sync insert; in-memory buffer is soft evolution |

Full feature 03 plan: [docs/features/03-ingest.md](features/03-ingest.md).

### Feature 04 — Events list + filters + detail (resolved 2026-05-01)

| # | Question | Resolution |
|---|---|---|
| Q-D1 | Filter UI placement | Top toolbar, chip-based |
| Q-D2 | Filter persistence | URL query params only |
| Q-D3 | Pagination | Keyset cursor (Newer/Older buttons) |
| Q-D4 | Detail view | Right drawer 520px, URL `?event=<id>` |
| Q-D5 | Stack trace | Collapsed by default, frame-level toggle |
| Q-D6 | Attributes / context | KeyValue list + JSON tree |
| Q-D7 | Saved views | Not in MVP |
| Q-D8 | Event export | Not in MVP |
| Q-D9 | Timestamp display | Local TZ in table, full+UTC in drawer, hover-relative |
| Q-D10 | Message search | Postgres tsvector full-text |
| Q-D11 | Auto-refresh state | `users.preferences.autoRefresh` (Redux + DB) |

Full feature 04 plan: [docs/features/04-events-list-filters.md](features/04-events-list-filters.md).

### Feature 05 — Dashboard (resolved 2026-05-01)

| # | Question | Resolution |
|---|---|---|
| Q-E1 | Aggregation strategy | Live `GROUP BY` queries; optimize per-widget if needed |
| Q-E2 | Cache | None in MVP |
| Q-E3 | Time range sync with events | Independent state per page; future cross-page passing via query params |
| Q-E4 | Widget config | Hardcoded 5 widgets |
| Q-E5 | Auto-refresh cadence | Shares `users.preferences.autoRefresh` with events page |
| Q-E6 | Empty state | Reuses feature 02 onboarding CTA |
| Q-E7 | Click-through | Yes — widgets link to events with pre-applied filters |
| Q-E8 | Time range presets | 15m / 1h / 6h / 24h / 7d / 30d / custom |

Full feature 05 plan: [docs/features/05-dashboard.md](features/05-dashboard.md).

### Feature 06 — Alerts (resolved 2026-05-01)

| # | Question | Resolution |
|---|---|---|
| Q-F1 | Evaluation pattern | Global tick worker, every minute via pg-boss |
| Q-F2 | Cooldown | State machine `ok ↔ firing`, notify on transition; `notify_on_resolve` toggle |
| Q-F3 | Webhook channel UI | URL + headers; no payload templating |
| Q-F4 | Test fire | Yes; sends with `test:true`, no history row |
| Q-F5 | History UI | Tab on rule page (Configuration / History) |
| Q-F6 | Disabled state | Hidden by default in list; toggle on rule page |
| Q-F7 | Retry policy | 3 attempts on 5xx/timeout, backoff 30s/2m/5m; 4xx fails fast |
| Q-F8 | Sample events in payload | 3 latest matches (no stack trace) + events_url |
| Q-F9 | Permissions | `alerts.manage` (existing) |

Full feature 06 plan: [docs/features/06-alerts.md](features/06-alerts.md).

### Feature 07 — Polish (resolved 2026-05-01)

| # | Question | Resolution |
|---|---|---|
| Q-G1 | Polish scope | 8 must-have areas; saved views, export, shortcuts, bulk, audit-UI, project-transfer deferred |
| Q-G2 | Global error boundary | Plain page with retry + home; no user-side error reporting |
| Q-G3 | 404 page | Custom but simple |
| Q-G4 | Permission denied | Explicit 403 page (not masked as 404) |
| Q-G5 | Slow query detection | pino WARN on queries > 500ms via Drizzle middleware |
| Q-G6 | Form pattern consistency | Sweep features 01–06 for unified submit/loading/toast patterns |
| Q-G7 | Telemetry | `/api/version` + extended `/api/health/ready` (DB, pg-boss, last ingest, migrations) |

Full feature 07 plan: [docs/features/07-polish.md](features/07-polish.md).

### Feature 08 — Docker packaging (resolved 2026-05-01)

| # | Question | Resolution |
|---|---|---|
| Q-H1 | App multi-stage | 3 stages (deps/builder/runner), `output: 'standalone'` |
| Q-H2 | Worker container | Same image, different entrypoint |
| Q-H3 | Postgres image | Reuses custom image from feature 03 |
| Q-H4 | Secrets | `.env` file on host, mode 600, mounted via `env_file:` |
| Q-H5 | Migrations | One-shot init container, `service_completed_successfully` gate |
| Q-H6 | Backup scheduling | Dev: none. Prod: `while sleep` loop, 3 local files max, env-configurable. Offsite via rclone with bucket-managed retention. |
| Q-H7 | Health probes | HTTP for app/postgres/proxy, file-mtime for worker |

Full feature 08 plan: [docs/features/08-docker-packaging.md](features/08-docker-packaging.md).

---

## 4. Data Model

### Auth & Organizations

```
users                    (id, email, name, password_hash, created_at)
sessions                 (id, user_id, token, expires_at)
accounts                 (id, user_id, provider, provider_id)         -- OAuth, future

organizations            (id, name, slug, plan, limits jsonb,
                          allow_signup boolean, created_at)
roles                    (id, organization_id, name, description,
                          permissions text[], is_system boolean,
                          is_default boolean, created_at, updated_at)
                         UNIQUE (organization_id, name)
organization_members     (organization_id, user_id, role_id,
                          is_owner boolean, joined_at)
                         PK (organization_id, user_id)
invitations              (id, organization_id, email, role_id, token,
                          expires_at, invited_by, created_at)
```

### Projects

```
projects                 (id, organization_id, name, slug,
                          retention_days, created_at)
project_member_roles     (project_id, user_id, role_id)               -- per-project override
api_keys                 (id, project_id, name, key_hash,
                          last_used_at, created_at, revoked_at)
```

### Events (partitioned daily)

```sql
events
  id                uuid
  project_id        uuid          -- indexed
  timestamp         timestamptz   -- partition key, indexed
  level             text          -- 'debug'|'info'|'warn'|'error'|'fatal'
  message           text          -- GIN tsvector for full-text
  source            text          -- 'frontend'|'backend'|'mobile'|...
  environment       text          -- 'prod'|'staging'|'dev'
  release           text

  -- correlation
  user_id           text
  session_id        text
  request_id        text
  trace_id          text

  -- error fields (no fingerprinting yet)
  error_type        text
  stack_trace       text

  -- flexible
  attributes        jsonb         -- GIN
  context           jsonb

  -- HTTP
  user_agent        text
  ip                inet

PARTITION BY RANGE (timestamp) -- daily
```

**Indexes**:
- `(project_id, timestamp DESC)` — main feed
- `(project_id, level, timestamp DESC)` — level filter
- GIN on `attributes` — arbitrary attribute filtering
- GIN on `to_tsvector('simple', message)` — message search

### Alerts

```
alert_rules              (id, project_id, name, filter jsonb,
                          condition jsonb, channels jsonb, enabled,
                          created_by, created_at)
alert_notifications      (id, alert_rule_id, triggered_at,
                          payload jsonb, status)
```

---

## 5. RBAC & Permissions

### Concept

- **Permissions** are hardcoded atoms in code (`shared/permissions/registry.ts`).
- **Roles** are DB rows with an array of permission keys.
- **Owner** is a flag (`is_owner: boolean`) on `organization_members` — not a role.
  Owner always has all permissions plus exclusive ones.
- Each org seeds three system roles on creation: `Admin`, `Member`, `Viewer`.
- Owner can edit system role permissions, create custom roles, delete custom roles.
- A user has one role per organization. Optional per-project role override.

### Permission registry (locked in)

```ts
export const PERMISSIONS = {
    // Organization
    'org.read':              'View organization',
    'org.update':            'Edit organization settings',
    'org.delete':            'Delete organization',          // owner-only, not assignable
    // Members & Roles
    'members.read':          'View members',
    'members.invite':        'Invite members',
    'members.remove':        'Remove members',
    'members.role.assign':   'Change member roles',
    'roles.manage':          'Create and edit custom roles', // owner-only, not assignable
    // Projects
    'projects.create':       'Create projects',
    'projects.read':         'View projects',
    'projects.update':       'Edit projects',
    'projects.delete':       'Delete projects',
    // Events
    'events.read':           'Read events',
    'events.delete':         'Delete events',
    // Alerts
    'alerts.read':           'View alerts',
    'alerts.manage':         'Create/edit/delete alerts',
    // API keys
    'api_keys.read':         'View API keys',
    'api_keys.manage':       'Create/revoke API keys',
} as const;

export type Permission = keyof typeof PERMISSIONS;
```

### System role defaults

| Role | Default permissions |
|---|---|
| Admin | everything except `org.delete`, `roles.manage` |
| Member | `org.read`, `members.read`, `projects.read`, `events.read`, `alerts.read`, `api_keys.read` |
| Viewer | all `*.read` permissions |

### Permission check

```ts
function hasPermission(member: Member, permission: Permission): boolean {
    if (member.is_owner) return true;
    return member.role.permissions.includes(permission);
}
```

---

## 6. Pages & Routes

```
PUBLIC
/login
/invite/[token]                           — accept invite
/forgot-password

USER SCOPE
/                                         — landing / org picker / redirect
/account                                  — profile
/account/sessions                         — active sessions

ORGANIZATION SCOPE                        permission required
/[org]                                    members.read           — overview
/[org]/projects                           projects.read
/[org]/projects/new                       projects.create
/[org]/team                               members.read
/[org]/settings                           org.update
/[org]/settings/roles                     roles.manage           — owner-only
/[org]/settings/roles/new                 roles.manage
/[org]/settings/roles/[id]                roles.manage
/[org]/settings/danger                    org.delete             — owner-only

PROJECT SCOPE
/[org]/[project]                          projects.read          — dashboard
/[org]/[project]/events                   events.read
/[org]/[project]/events/[id]              events.read
/[org]/[project]/alerts                   alerts.read
/[org]/[project]/alerts/new               alerts.manage
/[org]/[project]/alerts/[id]              alerts.read
/[org]/[project]/settings                 projects.update
/[org]/[project]/settings/api-keys        api_keys.read
/[org]/[project]/settings/members         members.read

API
POST /api/ingest                          api-key auth
POST /api/ingest/batch                    api-key auth
GET  /api/health                          public (TBD)
```

`app/` only contains layouts/pages composing features. No business logic there
(project rule).

---

## 7. Feature Structure (FDD)

```
features/
  auth/                  — login, session handling, invite acceptance
  organizations/         — org CRUD, member management
  roles/                 — role registry, role CRUD UI, permission checks
  projects/              — project CRUD, members
  events/                — feed, filters, detail view, search
  dashboard/             — widgets, charts, aggregations
  alerts/                — rules, evaluation, notification dispatch
  ingest/                — server-side ingest pipeline (validate, enrich, write)
  api-keys/              — generate, revoke, last-used tracking
  billing/               — empty stub for future Stripe integration
  notifications/         — provider abstraction (email/SMS/webhook)

shared/
  components/            — UI kit (Button, Input, Modal, Table, ...)
  services/              — db client, query helpers
  hooks/                 — useDebounce, usePolling, useFilters, ...
  utils/                 — formatDate, parseStack, ...
  permissions/           — registry + check helpers

core/
  store/                 — Redux Toolkit slices: user, theme, lang
  db/                    — Drizzle schema + connection
  auth/                  — better-auth config

app/
  — App Router only. Layouts, pages, route handlers that compose features.
```

Cross-feature imports forbidden. If something is shared, move it to `shared/`.

---

## 8. Ingest

### Endpoints
- `POST /api/ingest` — single event
- `POST /api/ingest/batch` — array of events

### Auth
API key per project. Header: `Authorization: Bearer <key>`.
Server hashes and matches against `api_keys.key_hash`.

### Pipeline
1. Authenticate (api_key → project_id).
2. Validate body with Zod.
3. Enrich (timestamp default, ip, user-agent from headers if absent).
4. Insert into `events` (multi-row insert for batch).
5. Return 202 Accepted.

### Strategy
Start without an in-memory buffer. Plain `INSERT` per request, multi-row insert
for batch. At 1M/day this is ~12 events/sec average. If ingest becomes a
bottleneck, add a buffer flush every N ms or K events. Soft evolution, no
re-architecture.

---

## 9. Auto-refresh

No SSE / WebSockets.

- Events page has a control: `Auto-refresh: off / 10s / 30s / 60s`.
- Client uses `setInterval` to call a Server Action / route handler.
- Use TanStack Query polling **or** plain `useEffect` + `revalidatePath`.

---

## 10. Events Filters

Approved as flexible/easy-to-change. Initial set:

- **Time range** — last 15m / 1h / 6h / 24h / 7d / custom.
- **Level** — multi-select: debug, info, warn, error, fatal.
- **Environment** — multi-select.
- **Source** — multi-select.
- **Release** — multi-select.
- **Message** — full-text search (Postgres tsvector).
- **error_type** — multi-select (when present).
- **user_id / session_id / request_id / trace_id** — exact match.
- **Attributes** — key-value pairs (`attribute.key = value`), multiple ANDed.

Filter UI must be data-driven so adding new filters = adding a config entry, not
rewriting the page.

---

## 11. Dashboard Widgets

Per-project dashboard, MVP:

- Events per minute (line chart, time range from page filter).
- Breakdown by level (donut/bar).
- Breakdown by environment (bar).
- Top 10 messages by count (table).
- Recent errors (last N events with level=error/fatal).

All widgets respect the current time range filter.

---

## 12. Alerts

### MVP rule type
**Threshold only**: `count(events matching filter) >= N within last M minutes`.

### Rule shape

```jsonc
{
    "filter": { /* same shape as events filter */ },
    "condition": { "type": "threshold", "count": 10, "windowMinutes": 5 },
    "channels": [{ "type": "webhook", "url": "..." }, { "type": "email", "to": "..." }]
}
```

### Evaluation
- pg-boss recurring job per enabled rule (or one global job that loops over rules).
- Query window with filter, compare count, dispatch via notifications feature.
- Write `alert_notifications` row regardless of channel success.

### Future rule types (deferred)
- New error fingerprint (requires error grouping — out of MVP).
- Spike / anomaly detection.

---

## 13. Notifications (Provider Abstraction)

Decision deferred on concrete provider. Architecture ready from day one:

```ts
// features/notifications/types.ts
type NotificationChannel =
    | { type: 'email'; to: string }
    | { type: 'sms'; to: string }
    | { type: 'webhook'; url: string; headers?: Record<string, string> }
    | { type: 'slack'; webhookUrl: string };

interface NotificationProvider {
    send(channel: NotificationChannel, payload: NotificationPayload): Promise<void>;
}
```

Each channel type has a separate provider implementation registered in a map.
Adding SMS later = adding a new provider, no changes to alert dispatch code.

### MVP scope
- **Webhook** is the only fully implemented channel (covers Slack, Discord,
  Telegram bots, custom endpoints — all are HTTP POST under the hood).
- Webhook targets pass an **SSRF guard** — syntactic checks at save time,
  DNS resolution re-checked before every delivery, and redirects refused.
  Any future channel that fetches a user-supplied URL must reuse it; see
  `docs/reference/security.md#outbound-request-safety-ssrf`.
- **Email**, **SMS**, **Slack** (the typed variant): registered in the type
  union, but their providers throw `NotImplementedError`. Wiring real providers
  is a follow-up task, no schema changes required.

---

## 14. Retention

- Daily partition on `events.timestamp` via `pg_partman`.
- Auto-create future partitions, auto-drop partitions older than 30 days.
- Configured per-project `retention_days` is informational for now (always 30
  globally). Per-project retention requires a different strategy (TTL columns
  + scheduled deletes) — defer until needed.

---

## 15. Self-hosted Docker

### 15.1 Reverse proxy — Caddy

Caddy chosen over Nginx for one reason: zero-config Let's Encrypt with auto-renew.
Single domain, single backend — no need for Nginx complexity.

```caddy
# Caddyfile
logger.example.com {
    reverse_proxy app:3000
}
```

> **Resolved 2026-08-13 — the real `Caddyfile` now exists.** Two corrections
> were noted against the sketch above; here is how each landed.
>
> - **Port.** The concern was that the app listens on **80**, not 3000
>   (`next start -p 80`), so `reverse_proxy app:3000` would not connect. True of
>   the repo's npm scripts, but **not** of the container: the image runs
>   `.next/standalone/server.js`, which reads `PORT` from the environment and
>   never runs `next start`. The port was pinned explicitly at **3000**
>   (`ENV PORT=3000`), so `app:3000` is correct — but for a reason the sketch
>   never stated. 80 was rejected because a backend behind a proxy gains nothing
>   from a privileged port while adding a dependency on Docker's
>   `net.ipv4.ip_unprivileged_port_start=0` default, which the non-root `node`
>   user would otherwise need `CAP_NET_BIND_SERVICE` to work around. Reopen only
>   if the container has to be reachable on 80 without a proxy in front.
>   `npm run start`'s port 80 is unchanged and remains a local-only concern.
> - **Headers.** Confirmed and acted on. Caddy adds **no** security headers; the
>   app is the single source. A browser enforces every CSP header it receives,
>   and the proxy cannot know the per-request nonce, so a policy added there
>   blocks the nonced inline scripts Next uses to boot the client — a page that
>   renders but is inert. The `Caddyfile` carries this reasoning inline, at the
>   point where someone would be tempted to add a `header` block.
>
> See `docs/reference/security.md` and `docs/OPERATIONS.md`.

Switch to Nginx/Traefik only if we need fine-grained rate-limiting, complex
routing, or multiple subdomains.

### 15.2 Backups

**MVP strategy**: `pg_dump -Fc` via a dedicated `backup` container, only in
production compose. Dev compose has no backup service — keeps dev machines clean.

- **Local retention**: max **3 files** (env-configurable: `BACKUP_RETENTION_COUNT`,
  default `3`).
- **Frequency**: env-configurable via `BACKUP_INTERVAL_HOURS` (default `24`).
- **Mechanism**: `while sleep` loop inside the container — runs immediately on
  startup, then every interval.
- **Offsite**: `rclone copy` to S3-compatible bucket (Backblaze B2 / Cloudflare
  R2 / MinIO). Retention in the bucket is managed by lifecycle rules there —
  out of scope of our backup script.
- **Restore**: `scripts/restore.sh <dumpfile>` documented in
  `docs/OPERATIONS.md`.

DB size projection: ~22 GB raw → ~5 GB compressed dump. Single dump completes
in minutes. 3 local files = ~15 GB max.

Switch to **pgBackRest** only when:
- DB > 50 GB, or
- PITR (point-in-time recovery) becomes a requirement.

### 15.3 Health endpoints & logging

Endpoints (always-on, public):

```
GET /api/health        — liveness. Returns { status, uptime, version }.
GET /api/health/ready  — readiness. Checks Postgres reachability and pg-boss
                          worker liveness. Returns 503 if any check fails.
```

Used by Docker `healthcheck` and any future orchestrator.

**Logging**: structured JSON via `pino` to stdout. Docker captures it. No
log shipper in MVP — `docker logs` is enough for an internal tool.

**Metrics**: Prometheus deferred. When added later:
- Endpoint `/api/metrics` via `prom-client`.
- Counters: `events_ingested_total{project_id, level}`.
- Histograms: `ingest_latency_ms`, `alert_evaluation_duration_ms`.
- Gauge: `pgboss_queue_depth`.
- Optional Grafana stack as a separate compose file.

### 15.4 Compose layout

> **Superseded 2026-08-13 by the real `docker-compose.yml`.** The sketch below
> is kept for its intent; where it disagrees with the file, the file wins.
> Notable differences, all discovered while making it actually run:
> - `app`/`worker`/`migrate` share one image via a YAML anchor, and `migrate`
>   is a real service (the sketch omitted it from the yaml despite §15.5
>   deciding on it).
> - Healthchecks target port **3000** (see §15.1), and the worker's is a
>   file-mtime probe, not HTTP.
> - `postgres` publishes **no** ports — the sketch's `5432` would be exposed to
>   the internet on most VPS firewall setups.
> - The stack declares `name: logger-prod`. Without it, both compose files
>   default to the folder name and running production in a developer checkout
>   recreates the dev Postgres container against the dev data volume.
> - `backup` needs its own image (`db/backup.Dockerfile`): `postgres:16-alpine`
>   plus `rclone`, since the stock postgres image has no rclone. Its remote is
>   configured through `RCLONE_CONFIG_*` environment variables rather than a
>   bind-mounted `rclone.conf` — a bind mount of a file that does not exist yet
>   is silently created by Docker as an empty *directory*.

```yaml
services:
  proxy:
    image: caddy:2-alpine
    ports: ["80:80", "443:443"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on: [app]

  app:
    build: .
    environment:
      - DATABASE_URL
      - AUTH_SECRET
    depends_on:
      postgres: { condition: service_healthy }
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3000/api/health"]
      interval: 30s
      timeout: 5s
      retries: 3

  worker:
    build: .
    command: ["node", "dist/worker.js"]
    environment:
      - DATABASE_URL
    depends_on:
      postgres: { condition: service_healthy }

  postgres:
    image: postgres:16
    # pg_partman extension installed via init script
    environment:
      - POSTGRES_DB
      - POSTGRES_USER
      - POSTGRES_PASSWORD
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./db/init:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $$POSTGRES_USER"]
      interval: 10s

  backup:
    image: postgres:16
    depends_on: [postgres]
    environment:
      - PGHOST=postgres
      - PGUSER
      - PGPASSWORD
      - RCLONE_REMOTE        # e.g. b2:logger-backups
    volumes:
      - backups:/backups
      - ./scripts/backup.sh:/backup.sh:ro
    entrypoint: ["/bin/sh", "/backup.sh"]
    # run via cron-like loop inside script, or trigger via external scheduler

volumes:
  pgdata:
  backups:
  caddy_data:
  caddy_config:
```

### 15.5 Implications & operational notes

- **Migrations**: run on app start (Drizzle migrate) or via a one-shot init
  container. Decision: one-shot init container — keeps app start deterministic.
- **Worker**: separate container, not in the Next.js process. Cleaner restart
  semantics, easier to scale independently if ingest grows.
- **Env vars** (minimum): `DATABASE_URL`, `AUTH_SECRET`, `RCLONE_REMOTE` (for backups).
- **First-run bootstrap**: `pg_partman` setup, initial 30 daily partitions
  pre-created, scheduled retention via `pg_partman.run_maintenance()`.

---

## 16. Roadmap (Implementation Order)

Each feature has its own doc in `docs/features/`. Live status is tracked in
`docs/PROGRESS.md`.

| # | Feature | Doc | Status |
|---|---|---|---|
| 00 | Foundation | [features/00-foundation.md](features/00-foundation.md) | 🟦 Planned |
| 01 | Auth + Organizations + Roles | [features/01-auth-organizations-roles.md](features/01-auth-organizations-roles.md) | 🟦 Planned |
| 02 | Projects + API keys | [features/02-projects-api-keys.md](features/02-projects-api-keys.md) | ⬜ Stub |
| 03 | Ingest | [features/03-ingest.md](features/03-ingest.md) | ⬜ Stub |
| 04 | Events list + filters + detail | [features/04-events-list-filters.md](features/04-events-list-filters.md) | ⬜ Stub |
| 05 | Dashboard | [features/05-dashboard.md](features/05-dashboard.md) | ⬜ Stub |
| 06 | Alerts | [features/06-alerts.md](features/06-alerts.md) | ⬜ Stub |
| 07 | Polish | [features/07-polish.md](features/07-polish.md) | ⬜ Stub |
| 08 | Docker packaging | [features/08-docker-packaging.md](features/08-docker-packaging.md) | ⬜ Stub |

Status legend:
- ⬜ Stub — feature doc exists, contents pending detailed planning
- 🟦 Planned — feature doc fully detailed with checklist, ready to implement
- 🟨 In progress — implementation underway
- ✅ Done

Planning happens just-in-time: we detail the next feature when we're about
to start it, not all at once.

### 16.1 Post-beta workstream: read-path performance

The numbered features above build the product. This workstream makes it hold
up. It was opened on **2026-08-20**, after the staging run put real volume
behind the app for the first time and the org overview came back at **1.4–1.6
seconds** on 540k events — with the machine at 8% CPU, so the time was not
resource exhaustion but query and page structure.

The measured evidence behind every stage below is in
[`LAUNCH.md` §0.1](LAUNCH.md#01-where-it-runs); the audit that produced the
ordering is summarised in [`PROGRESS.md`](PROGRESS.md#read-path-audit-2026-08-20).

> ⚠️ **Every stage begins with a discussion, not with code.**
>
> A finished stage is not permission to start the next one. Before each stage
> opens, we sit down with the numbers the previous stage produced and decide:
> is the next stage still the right next thing, has its scope changed, and is
> the ordering below still correct? This is deliberate — the ordering was
> derived from one afternoon of measurement on one machine at one data volume,
> and every stage produces evidence that can invalidate the stages after it.
>
> A stage that starts because the previous one ended, rather than because we
> looked at what it produced, is how this list turns back into guesswork.

**Stage A — Documentation.** Bring `PLAN.md` and `PROGRESS.md` in line with
what the staging run and the audit established, so the workstream has a
written baseline. *(This section is that change.)*

**Stage B — Tests for the read paths about to change.** `features/overview/`
had **zero test coverage** and is exactly what Stages D and E rewrite. Per
[WORKFLOW.md](../.claude/rules/WORKFLOW.md) §2 the tests would ship with each
change anyway; pulling them forward is deliberate, because the first change
would otherwise pay the whole cost of establishing a test approach for a
service that talks to the database, in the middle of an optimisation.

*Status 2026-08-20: done.* Three layers, in this order: the page's parsing and
assembly logic extracted out of the route into `features/overview/utils/` and
unit-tested (73 tests across five modules); `e2e/overview.spec.ts` (19 tests)
asserting the rendered page; and `overview.service.ts` covered by 36 integration
tests against a real Postgres on a purpose-built `logger_itest` database
(`npm run test:it`). *Counts recounted 2026-08-20; they had read 50/17/38.*

The premise held, twice. Each of the two lower layers found a real bug that the
layer above could not see: the e2e spec found `ORDER BY` binding to a text alias
(so "top 5 errors" returned the wrong five once a count passed 9), and the
integration suite found an environment name containing a comma being split into
two environments. Stage D would otherwise have been rewriting a page whose
output nobody had ever checked, with both defects already in it.

Note for Stage C: the integration harness — database creation, migration,
seeding, connection — is reusable for the benchmark, but **its corpus is not**.
That one is enumerated and tiny by design; measurement needs the opposite. Share
the plumbing, not the data.

**Stage C — Make it measurable.** Three things, none of which changes app
behaviour.

> **Order correction, 2026-08-20.** The list below was originally written
> instrumentation-first, benchmark-last. That cannot work: tuning
> `shared_buffers` before there is a benchmark means the first measurement
> already contains the change, and nothing can say what the change did. The
> benchmark comes first, then a recorded baseline, then **one** change at a
> time.
>
> *Status: the benchmark harness is built* (`npm run bench`, see
> [`reference/misc.md`](reference/misc.md#testing)); `pg_stat_statements` and
> Postgres configuration are not started.
- `pg_stat_statements`. **Done 2026-08-20** — enabled via
  `shared_preload_libraries` in both compose files and created in
  `db/init/01-extensions.sql`. It immediately produced the environment-
  enumeration finding under Stage D below, and corrected the "eight
  aggregations" count to seven. Recording only; it does not change a plan.
- Postgres configuration. The image is stock `postgres:16`: `shared_buffers`
  128 MB on a 4 GB host, `work_mem` 4 MB. At 540k events disk reads had already
  appeared and the hash aggregate was at 64% of its budget. §0.1 of `LAUNCH.md`
  justifies its RAM sizing with a 25% `shared_buffers` rule that nothing
  implemented.

  **Partly done, deliberately.** As of 2026-08-20 both compose files expose
  `PG_SHARED_BUFFERS`, `PG_WORK_MEM`, `PG_EFFECTIVE_CACHE_SIZE`,
  `PG_MAINTENANCE_WORK_MEM` and `PG_RANDOM_PAGE_COST` — **with the stock values
  as defaults, so nothing changed**. Before this there was no `command:` and no
  mounted config, so no setting could be changed at all, let alone measured.
  Choosing values is the separate, measured step, and it **cannot be done on a
  developer machine**: a laptop's page cache holds the whole 265 MB corpus, so
  every `shared_buffers` value measures the same. It needs the constrained host.
- A repeatable benchmark script. Every number we have was produced by typing
  `EXPLAIN` by hand; that cannot prove an optimisation helped, and it certainly
  cannot compare storage engines later.

**Stage D — Remove the waste.**

> **Reordered 2026-08-20, on Stage C's evidence** — which is what the discussion
> gate is for. The list below was written caching-first; caching is now last.
>
> - **The environments registry is first** because it is the only item with a
>   measured, hardware-independent justification (a share of database time, not
>   a duration).
> - **Caching is last, and it is bigger than this list assumed.** In Next 16
>   `unstable_cache` is deprecated in favour of `use cache`, which requires
>   `cacheComponents: true` — an application-wide flag that makes Next raise an
>   error on unhandled uncached or runtime data access in *every* route. So it
>   is an audit of the whole app, not a change to one page. Its benefit also
>   scales with concurrent viewers, of which there is currently about one; the
>   original justification is explicitly conditional on other teams adopting the
>   tool. And doing it first would blind every measurement after it — Stage E
>   would be measuring cache hits, and a slow query under a cache looks fast
>   until it misses.
>
> **Superseded 2026-08-20 (same day) on the caching half — see item 5.** Two of
> the three reasons did not survive contact with the facts. The conditional
> premise fired: the stated target became 50–100 concurrent dashboards, at
> which point per-reader querying stops being slow and starts being the wrong
> shape (~6.8 cores to compute one answer two hundred times). And the "audit of
> the whole app" was a property of `use cache` specifically, not of caching:
> a cache in the service layer needs no application-wide flag. The third reason
> held and was honoured — caching still went **after** the rollup and the
> measurements, so Stage E is being ranked on uncached numbers.

In order:

1. **The environments filter list. Done 2026-08-20.** `pg_stat_statements` put
   the 30-day scan at **13.4% of the page's total database time**, spent on a
   list of a handful of values. Replaced by `project_environments`, a registry
   maintained at ingest — the pattern `attribute_key_types` already uses.
   Measured: **39.3 ms → 0.67 ms**, and the query no longer appears among the
   page's costs. Page wall-clock moved from ~106 ms to ~92 ms, which is inside
   the ~10% run-to-run noise — expected, since the query ran in parallel with
   slower ones. What was removed is database *work*, which is what matters once
   more than one person is looking. Details in
   [`reference/logging.md`](reference/logging.md#environment-registry).

   **~~Still open: the per-project environment pills~~ — closed later the same
   day**, by the rollup rather than by the registry: `by_env` is stored per
   minute, so any range is a sum and the product question below never had to be
   answered. The paragraph is kept for the reasoning. `STRING_AGG(DISTINCT
   environment)` inside `getProjectSummaries` — 18.1% before, **23.8% after**,
   then the second most expensive query on the page. A registry cannot answer it
   as written, because those pills are scoped to the *selected range* while the
   filter list is not. Closing it means deciding what the pills mean — "the
   environments this project uses" or "the ones that appeared in this window" —
   and that is a product question, deferred on 2026-08-20 rather than settled
   inside an optimisation.
2. **A rollup table for the dashboards.** *First increment shipped 2026-08-20 —
   `event_rollup_minutes` + `rollup_state` + the `event-rollup` job, with the
   volume chart and level breakdown reading it. Everything keyed by message
   still reads `events`; that is increment two — **shipped later the same day**,
   with the per-project statistics and environment pills moving to the rollup
   too (`getProjectStats`, after `getProjectSummaries` was split in Stage E).
   Behaviour and rationale in [`reference/logging.md`](reference/logging.md#the-rollup).* Not the same thing as item 5 below: this is a summary
   table in Postgres, refreshed by a scheduled job, that the read path queries
   instead of `events` — the pattern the environments registry already proved
   on the smallest possible case.

   Shape settled in discussion: one row per `(project, minute)`, `total` plus
   `by_level` / `by_env` as JSONB, `errors` as a generated column derived from
   `by_level` so the two cannot disagree, `computed_at` so the UI can say what
   the numbers are as of. Refreshed every 60 seconds, which aligns exactly with
   the minute grain — each run closes one minute, and a number shown never
   changes retroactively.

   Two properties decided the design over maintaining counters at ingest:
   **periodic recompute is self-healing** (each run rebuilds from `events`, so
   drift cannot accumulate the way incremental counters do), and it leaves the
   ingest path untouched, with no contention on hot counter rows.

   Scope, from the inventory: **74% of measured overview cost is servable, 21%
   is not.** Anything keyed by message stays on raw events — 168k distinct
   messages per 500k events, and merging per-minute top-N lists is
   *approximate* in a way that would produce plausible wrong numbers. Since the
   stated reason for the rollup is that everyone should see the same figures,
   making them quietly incorrect would defeat it.

   Still open: what the job does on first run over existing data, how
   late-arriving events are caught (ingest accepts timestamps up to 30 days
   old, so a recompute of "recent minutes" would miss them), and whether the
   auto-refresh intervals should differ between the dashboards and the event
   list — the list must stay live and has no business being served stale.

3. **Streaming. Done 2026-08-20.** The org page awaited a `Promise.all` of every
   aggregation and rendered nothing until the slowest returned, which is why the
   measured 1.4 s was time-to-first-pixel rather than time-to-last-widget;
   `Suspense` was imported and had nothing to do. The page is now six
   independently streaming sections.

   **The route creates the promises and passes them down unawaited**, rather
   than each section calling the service itself. That choice is the whole
   change: sections needing the same query share one promise, so the bucket and
   summary queries are still issued once each. Had each section fetched its own,
   streaming would have *doubled* those two — a change made to speed the page up
   would have slowed it down. Verified with `pg_stat_statements`: the bucket
   query, awaited by two sections, records the same call count as the top-errors
   query, awaited by one.

   It also keeps the cross-feature composition (`features/projects`,
   `features/alerts`) in the route, where §2.3 allows data loading, instead of
   pulling two features into `features/overview` against §2.1.

   Reduces no database work. Changes when the first pixel arrives — which on
   this page is the largest thing a person notices, and the reason it cannot be
   demonstrated locally: on a developer machine every query returns in
   milliseconds, so there is nothing to stream. The benefit is on the
   constrained host, where the page took 1.4 s.

4. **The serialised page prologue**: four round trips before any real work, plus
   a fifth on the project dashboard. Not yet measured — it sits outside the
   benchmark's fan-out.

5. **Caching of dashboard aggregations. Done 2026-08-20 for the org overview.**
   The app is fully dynamically rendered (§17, CSP nonce), so every viewer
   recomputed every aggregation on every load — load grew linearly with the
   number of people looking at a dashboard, before a single extra event was
   ingested. The events list stays uncached; staleness is acceptable on a chart
   and not on a log tail.

   `overview-cache.service.ts` over `shared/utils/ttl-cache.ts`: 30-second TTL,
   5-minute staleness ceiling, single-flight, stale-while-revalidate, keyed on
   the project scope + range **preset** + filters. Rationale, and why this was
   preferred to `use cache` and to `unstable_cache`, in §17.

   Verified end to end with `pg_stat_statements` against the dev server: a
   second page load inside the window issues **none of the five**, a different
   preset misses, and both the environment filter list and top errors *hit*
   across a 7d→30d change — the former because it is keyed without a range,
   the latter because `clampTopErrorsWindow` maps both presets to 24h.

   **Not done:** the project dashboard (`features/dashboard`) is still
   uncached, and `aggregations.service.ts` — the file that would have to change — still has no test beside it. That is Stage E work.

   Deliberately not claimed: this bounds how *often* the expensive queries run,
   not what they cost. The two message-keyed aggregations remain ~96% of the
   page's database time when they do run, and they grow with data age.

**Stage E — Query-level work.** Ordered by what Stage C's data says, not by
this list.

- ~~The five facet-count aggregations that run on every events-page load even
  when the filter panel is closed.~~ **Done 2026-08-20**, ahead of its stage:
  they load when the panel opens, and a normal events page is now a single
  keyset query. Taken early because it came up while deciding the rollup's
  scope and cost nothing to settle there — the alternative on the table was
  deleting the counts outright, which would have removed a working feature to
  buy something on-demand loading gives for free. Next for the same surface:
  dropping the `RELEASE` and `ERROR TYPE` facets, which typically show one
  option carrying the full count.

Remaining candidates: the top-messages widget
(measured at 654 ms alone, where the scan is only a quarter of the cost and the
rest is sorting and merging tens of thousands of groups); and indexes on
`environment`/`source`/`release`, which do not exist and are not free to add to
a table taking a thousand inserts a minute.

> **The first benchmark already disagrees with that ordering.** On a local
> 500k corpus the most expensive single query is `getOrgEventBuckets` (~100 ms),
> four times `getOrgTopErrors` (~26 ms) — and that is with 168k distinct
> messages against the droplet's 68,933, which should have made top errors
> *worse* here, not better. The 654 ms figure therefore cannot be a property of
> the query shape; it belongs to the hardware, the untuned configuration, or the
> concurrent ingest load. Which of the three is exactly what the rest of Stage C
> is for. **Do not reorder this list on the strength of one local run** — the
> whole reason for the discussion gate is that a single measurement on a single
> machine is what produced the current ordering in the first place.

**Stage F — Scaling blockers that are not query performance.** The connection
pool of 10 against eight queries per page; the single app replica the in-memory
rate limiter forces; and a backup strategy (`pg_dump` plus three local copies)
that does not survive an order-of-magnitude growth under any storage engine.

**Deferred — the storage engine decision.** See §17, 2026-08-20. Not part of
this workstream, and deliberately not decided until there is a million events
to decide on.

### 16.2 The project dashboard — same pattern, measured first

`/[org]/[project]` **was** roughly where the org overview stood *before* Stage B
when this section was written: no tests on `aggregations.service.ts`, no
streaming (the route awaited one `Promise.all`), business logic in the route
file, and two live defects nobody could safely fix because nothing could prove a
fix. All four are closed — see the item list below.

**Measured 2026-08-21** — `features/dashboard/services/aggregations.service.bench.ts`,
against the 500k local corpus, a 24-hour window, baseline in
`bench/baselines/2026-08-21-local-500k-dashboard.json`:

| query | mean | net of the 0.26 ms floor |
|---|---|---|
| `hasAnyEvents` | 0.79 ms | 0.5 |
| `recentErrors` | 0.84 ms | 0.56 |
| `topSources` | 11.1 ms | 11.0 |
| `levelBreakdown` | 11.6 ms | 11.3 |
| `eventsPerMinute` | 44.2 ms | 43.1 |
| **`topMessages`** | **170.5 ms** | **169.9** |
| fan-out of five, in parallel | **169.0 ms** | |
| what the route does (gate, then fan-out) | **170.2 ms** | |

Three things the run settled, two of them against what was expected going in:

- **`topMessages` is the page.** 170 ms of a 170 ms fan-out; the other four sum
  to 67 ms and run entirely inside its shadow.
- **The serialised `hasAnyEvents` gate costs about 1.2 ms** — the gap between
  the two page benchmarks, under 1% of the page, and itself inside the
  run-to-run noise on a 170 ms measurement (a second run put it at 0.4 ms). It
  was predicted to be a significant part of the page's latency. Moving it inside
  the `Promise.all` would be measuring noise. *Prediction refuted by the
  measurement; recorded because the prediction was made out loud.*
- **`topSources` needing a `by_source` rollup column is not urgent** — 11 ms,
  hidden behind a 170 ms query.

**All six shipped 2026-08-21.** What each turned up is noted inline below.

**Ordering.** Steps 1–3 are §1/§2 debt owed regardless of any measurement, and
nothing may touch a query before them:

1. **Tests for `aggregations.service.ts`. Done** — `aggregations.service.itest.ts`,
   26 tests, against a `DASH` fixture project whose counts (10 error/api,
   9 warn/worker, 2 info/cron) are chosen so ordering by count *as text* and *as
   a number* disagree on the **first** element. Twenty-one events expose both
   defects.
2. **The two live `ORDER BY` defects. Done**, failing test first: all three
   targeted tests failed against the old code and pass against the new. The
   visible one was `topSources`, which applies a `LIMIT` — asking for the top 2
   of api (10), worker (9), cron (2) returned worker and cron, dropping the
   busiest source entirely. `environmentBreakdown()` and its widget were deleted
   rather than fixed; they carried the third occurrence and had been rendered
   nowhere since before the audit.
3. **One `parseRange`, out of the route. Done** — `features/dashboard/utils/dashboard-range.ts`,
   with `DASHBOARD_PRESETS` **derived** from the schema's `TIME_RANGE_PRESETS`
   rather than restated, and a test asserting the derivation rather than the
   contents. There had been three lists and two parsers, agreeing by
   coincidence; the same drift shipped a live defect the previous day when
   `AutoRefreshValue` gained `5m` and the Zod enum validating it did not.
   `export const dynamic = "force-dynamic"` went with them — the build still
   reports the route as `ƒ (Dynamic)`, since it reads `searchParams` and cookies.
4. **Streaming. Done** — `DashboardPage` is a Server Component, the route passes
   six unawaited promises, and every widget is its own `Suspense` boundary.
   Verified by delaying `topMessages` three seconds: the page began streaming at
   **318 ms** and the stream stayed open to 3196 ms, so only that one widget
   waited.

   It also removed a defect rather than only restructuring. `DashboardPage`
   called `useAutoRefresh()` **and** rendered `DashboardHeader`, which renders
   `AutoRefreshControl`, which calls `useAutoRefresh()` too — two intervals, two
   `router.refresh()` per tick, the dashboard reloading itself twice as often as
   the setting said. A Server Component cannot hold a hook, so the duplicate
   could not survive the move.
5. **The rollup. Done** for `eventsPerMinute`, `levelBreakdown` and
   `hasAnyEvents`, all from `by_level` — no migration. The boundary moved to
   `shared/services/rollup-boundary.service.ts` rather than being copied, which
   revived `shared/services/`; it also gained a guard the overview's copy
   lacked, for a project absent from `rollup_state` entirely.

   ⚠️ The tests that matter here live in `event-rollup.service.itest.ts`, not in
   `aggregations.service.itest.ts`. The shared fixture inserts events directly
   and never builds a rollup, so `rollupBoundary` is null there and every read
   falls back to raw `events` — tests written against it would pass without
   executing one line of the new code. Confirmed by breaking the rollup branch
   deliberately and watching exactly one test fail.
6. **The cache. Done** — `dashboard-cache.service.ts` over the same
   `shared/utils/ttl-cache.ts`, keyed by project id and range preset. The key
   builder and the TTL settings both moved to `shared/` rather than being
   copied. `hasAnyEvents` is deliberately excluded: it gates the onboarding
   screen, and the single moment its answer changes is the moment a stale "no
   events yet" would be worst.

   Verified with `pg_stat_statements`: a second load inside the window leaves
   every aggregation at one call. An auto-refresh tick therefore costs the
   uncached remainder — the gate, the org/membership/project lookups and
   `listAlertRules` — instead of six aggregations. Cheap, not free.

**Why 5 is on the list even though the benchmark says it buys 0 ms of latency.**
Two reasons, and the second is the one that matters.

The weak reason is database *work*: `eventsPerMinute` and `levelBreakdown` cost
~55 ms of CPU per load, which is invisible at one reader and is 1.8 cores at a
hundred. The cache (6) bounds how *often* that is paid; the rollup bounds what
it *costs* each time. They compound.

The strong reason is that **the 0 ms figure was measured over a 24-hour window on
a three-day corpus, and does not generalise.** `eventsPerMinute` scans raw events
in proportion to the window; at a 30-day range over 30 days of data it scans
roughly thirty times more. The rollup-backed form reads per-minute rows —
43,200 per project — *regardless of range*. So the honest statement is not "the
rollup buys nothing here" but "the rollup buys nothing here **at this data
volume and this window**", which is exactly the caveat this workstream keeps
having to re-learn.

And the reason that is not about numbers at all: **one read pattern instead of
two.** Not every query can move — `topMessages` is barred by cardinality and
`recentErrors` returns whole rows, the same way org top errors stays on raw
events. What becomes uniform is the *rule*: rollup plus raw tail wherever the
dimension is stored, raw events wherever cardinality forbids it. A rule that
holds on both pages is one a reader can carry between them; two pages with
different rules is how this repository got three copies of a preset list and a
test named after a service it never imported.

**`topSources` stays off the list until it is measured at 30 days.** It is safe
by cardinality — `source` is app-defined and bounded, unlike `message` or
`release` — but a `by_source` column is width added to every row of every minute
of every project, permanently, for 11 ms today. Its cost grows with the window
on the same reasoning as `eventsPerMinute`, so the answer may well be yes; it
should be a number rather than a symmetry argument.

---

### 16.3 The read-path ceiling, and what a message ought to be

Opened **2026-08-22**, when the staging corpus reached **8,895,570 events** — up
from 5,494,912 the day before, +3.4M in twenty-four hours — and the project
dashboard's cold times went superlinear against it:

| range | at 5.5M (2026-08-21) | at 8.9M (2026-08-22) |
|---|---|---|
| 1h | 0.25 s | 0.24 s |
| 6h | — | 5.6 s |
| 24h | — | 7.9 s |
| **7d** | **17.5 s** | **40.1 s** |
| 30d | 17.4 s | worse |

62% more data, 2.3x the time. Warm loads stayed at 300-500 ms throughout, so the
cache still works exactly as designed: it bounds how *often* the cost is paid and
does nothing about the cost itself, which is what it was always documented to do.

**The trajectory is the point, not the number.** At ~3.4M/day against 30-day
retention the corpus levels off near **100M events**, roughly eleven times
today's. Nothing in 16.1 or 16.2 addresses that: the rollup does not cover
message-keyed reads, and the cache multiplies a cost it cannot reduce.

#### What was eliminated, and what it cost to find out

Four hypotheses, tested in one session with session-scoped SET, changing nothing
on the server. Three failed. They are recorded because each was stated out loud
as a likely cause, which is the failure the stage gate exists to catch.

- **work_mem - refuted.** The 4 MB default made the sort spill ~250 MB to disk,
  which looked like the whole explanation. Removing the spill entirely bought
  **7%**: 28,991 ms at 4 MB, 28,491 ms at 64 MB (still spilling), 26,855 ms at
  256 MB (quicksort in memory, no spill). **512 MB was worse - 37,670 ms** -
  memory pressure on a 4 GB host. The spill was a symptom.
- **JIT - real but small.** 136 functions, **2,098 ms** of compile on every
  execution, because the query cost (1,258,241) sits far above jit_above_cost.
  Worth disabling for this workload; worth 7% of the problem.
- **Hashing was not being rejected, it was forbidden.** With enable_sort=off,
  which adds a ten-billion penalty to every sort, the planner **took the penalty
  and sorted anyway** - visible in the plan as cost=10001166953. That is not
  "sorting is cheaper", that is "there is no alternative".
- **The planner is also flying blind.** It estimates **200 groups** where there
  are **1,133,715** - a 5,600x underestimate, because SUBSTRING(message,1,200)
  is an expression and Postgres keeps no n-distinct statistics for expressions.

#### What actually locks the plan: mode() WITHIN GROUP

topMessages computes dominant_level with `mode() WITHIN GROUP (ORDER BY level)`.
Ordered-set aggregates require sorted input per group, so while one is in the
select list **HashAggregate is unavailable at any work_mem**. The whole query was
pinned to sort-then-group by a coloured dot in the widget.

Removing it, same settings: **26,855 ms -> 17,021 ms, -37%**, and the plan gains
Partial HashAggregate with Batches: 1 and no spill.

The replacement is `COUNT(*) FILTER (WHERE level = ...)` per level - ordinary
aggregates, which do not forbid hashing - with the dominant level picked from
five integers in application code. Also *more* correct: mode() breaks ties
arbitrarily, while an explicit rule can break them toward the more severe level,
which is what a "what should I look at" widget wants.

**This is 40% of an answer, not an answer.** Seventeen seconds is still seventeen
seconds, and it grows with the corpus.

#### The structural answer: a message is a name, not an instance

The cost is 1,133,715 groups over seven days, and it is that large because the
grouping key is raw text.

`Session sess_pw62y expired` is a unique string occurring once. It is also the
same event forty thousand times. Sentry and Datadog both resolve this the same
way, and it is the only approach that scales: **collapse the variable parts into
a template**, so `Session sess_* expired` is one row with a count of 40,000.

That is not merely cheaper, it is **more useful**. Nobody wants forty thousand
session identifiers ranked by frequency; they want to know that sessions expired
forty thousand times.

**And the values are not lost, because this product already has somewhere to put
them.** Events carry typed attributes with a registry enforcing their types
(reference/logging.md). `sess_pw62y` belongs in `attributes.session_id`, where it
is already filterable and already covered by the attribute machinery - not melted
into a prose string where the only thing anyone can do with it is read it.

So the rule this settles is about the **data model**, ahead of any optimisation:

> **`message` is the name of an event. Variable data belongs in `attributes`.**

Recorded in 17. It costs nothing to adopt in the docs and the ingest guide today,
and everything downstream gets easier: grouping, alerting on a class of event
rather than one instance, and eventually a template rollup keyed by a hash
instead of by text.

#### Where that leads, and the one number that decides it

With templates, topMessages becomes a fingerprint computed **at ingest** -
template_hash stored on the event, rolled up per (project, hour, hash), read as a
sum over a small integer key. Exact rather than approximate, because the grouping
key is stable; and it scales with the number of *kinds* of message rather than
the number of events. An application with five hundred distinct messages costs
the same at 100M events as at 1M.

Ingest can afford it: measured at **0.2 ms per insert**, the write path does not
appear in the page's cost profile at all.

**The blocker is that we cannot yet size it honestly.** Measured on staging:
2,477,278 rows in one day, **674,924 distinct raw messages (27.2%)**, and
**183,289 after a crude normalising regex (7.4%)** - a 3.7x collapse, not enough
on its own.

But that number describes **our load generator, not logs**. reference/misc.md
records that its message templates were deliberately built across three
cardinality classes, some effectively unique per event, precisely so the hash
aggregate would be stressed rather than flattered. We built an instrument to make
this query hard, and are now using it to decide whether the query is hard.

So 7.4% is a **worst case, not an expectation**, and the rollup cannot be sized
against it. What is needed first is a second generator profile shaped like real
application logs - few templates, high repetition, variables in attributes - and
the same measurement against that.

If templates collapse cardinality by one to two orders of magnitude, the template
rollup solves this outright and Postgres stays. If they do not, the storage
engine decision deferred in 17 on 2026-08-20 stops being deferrable: that entry
set the threshold at 1M events, and there are nine million.

#### Order

1. **Replace mode().** Measured, -37%, one query, needs a test. Not deployed the
   night before a demo - the same rule this workstream keeps.
2. **Choose work_mem against the hash's real appetite** (82 MB peak per process
   once hashing is possible), not against a guess. And jit=off for this workload.
3. **Adopt the message/attributes rule in the docs and the ingest guide.** Zero
   code, and it is what makes step 5 possible at all.
4. **A realistic generator profile, then size the template rollup against it.**
5. **Fingerprint at ingest** - or the engine conversation, depending on 4.

---

## 17. Decision Log

| Date | Decision | Rationale |
|---|---|---|
| 2026-08-25 | **The two dashboards share their filter bar, their KPI row's first card and their chart**, and `DashboardHeader`, `useDashboardRange`, `OrgVolumeChart` and `EventsPerMinuteWidget` are deleted | The request was that the two pages be one thing. The header was the clearest case of them not being: it offered `1h/24h/7d/30d` where the overview offered six presets, so a link between the dashboards could land on a range the destination could not show. The bar absorbed it, and the project's title, live rate and "+ New alert" became slots — a component, a hook and a segmented control gone for a bar that already existed. **The slots half of this was superseded four days later**: the title and rate moved to the application top bar and the alert link was deleted. See the next entry. |
| | | **`Events / min` became `Total events`, and the rate moved to the bar as a reading about the last minute.** The KPI divided the range's total by its length, so at 30 days it reported a month's traffic over 43,200 — a number that moved for reasons nobody could see and matched nothing else on screen. The overview's first KPI has always been a plain total. The rate itself was worth keeping but not as an average: asked for the *current* rate, the bucket series cannot answer at all, since at 30 days its width is 86,400 seconds. It is now its own trailing-60s query on its own **10-second** cache profile — the 30-second one would let a "last minute" reading describe a minute that ended ninety seconds ago. |
| | | **One chart, two modes.** It takes shaped points rather than buckets plus an accessor, because both callers are Server Components and the chart is a client one — a function cannot cross that boundary. Being forced into that shape was an improvement: the shaping arithmetic had lived inside two client components where no test could reach it, and `chart-points.ts` now has sixteen. `dynamic()` is repeated at both call sites rather than wrapped once, because §2.2 allows one component per folder and inventing a second file to save two lines is the wrong trade. |
| 2026-08-25 | **The project's name and live rate move to the application top bar; the dashboard's "+ New alert" shortcut is deleted** — `DashboardFilterBar` loses both slots and `ProjectPulse` is added | The slots were four days old and were already the wrong answer. A filter bar is a row of fixed-width controls; a project name is unbounded text. Put them on one line and the name pushes into the pills at any realistic name length, which is what the reporting screenshot showed. The top bar was empty on its left, is sticky, and is the row that already answers "where am I" — so the name and rate went up rather than sideways. The alert shortcut was **deleted rather than relocated**: the alerts page renders the same button in its header and again in its empty state, so it was a third copy of a link one click away, and the top bar is chrome shared by pages that have nothing to do with alerts. |
| | | **Two behaviour changes fall out of it being in a layout, and both were accepted deliberately.** The rate no longer narrows with the environment pills, because a layout cannot read `searchParams` in the App Router. Rejected: a `@topbar` parallel-route slot, which *is* a page and would receive them — it needs a `default.tsx` per sibling segment, so five files of routing machinery to keep one number filtered. The unfiltered reading is also the better one: it is now shown on settings and API-key pages that have no filters at all, where "the project's heartbeat" makes sense and "the current view's rate" does not. The second change is that it refreshes when the page does — a shared layout is preserved across navigation, so on pages with no auto-refresh control it is a snapshot from arrival. A timer of its own would mean a client component polling a Server Action on every project page, which is a lot of machinery for a decorative number. Reopen if anyone reports the staleness. |
| | | **The rate section renders `null` on failure instead of throwing**, and logs. Everywhere else a failed aggregation reaching `error.tsx` is correct, because the widget *is* the page. Here it is not: the layout wraps settings, alerts and API keys, so an unhandled rejection would replace all of them with an error screen because a counter in the corner could not be computed. `PROJECT.md` §9 forbids swallowing an error, not handling one. |
| | | `liveRate` moved to `shared/utils/live-rate.ts` with it. Importing `features/dashboard` from `features/projects` would have been the 55th cross-feature arrow §2.1 forbids, and the function had stopped being a KPI formatter the moment the rate left the KPI row. |
| 2026-08-25 | **`environment` joins the key of `event_rollup_minutes`, `by_env` is dropped, and the cap falls from 20 to 5** (migrations 0014/0015) | The 2026-08-20 design kept `by_level` and `by_env` as separate marginals, reasoning that a finer key multiplies rows by a dimension the client controls. The reasoning about *unbounded growth* was right; the conclusion was wrong, and the benchmark said so: neither marginal can answer "how many errors in production", so every environment-filtered read scanned raw `events` — `projectStats` 4.47 ms → 17.20, `levelBreakdown` 7.16 → 15.36, and the error-ratio chart could not be filtered at all. A key column is not the jsonb cross product that objection had in mind; it is one more comparison in an index. The cap now bounds **rows** rather than object size, which is why five replaces twenty. |
| | | **The per-project "top five" set from `project_environments` was designed and then not built.** It would have needed an event counter maintained on the ingest path — a dead tuple per environment per batch, on the very table introduced to avoid scanning — to guarantee something the rollup already records exactly. A minute that folds environments writes an `(other)` row; a filtered read that finds one, or an `(all)` row from before the migration, refuses the rollup and scans `events`. Conservative in the only direction that matters: it never serves a wrong number, it sometimes does more work. |
| | | **The merge that preceded this had quietly cost 8×, and only measuring found it.** Collapsing the two bucket queries gave the organization chart a per-level breakdown it does not draw: the old query read `total` and the generated `errors` column, the merged one ran `jsonb_each_text(by_level)` — a JSON parse per row and one output row per level. 3.96 ms → 33.6. That is the same failure `event_template_rollup` already documents at 547 ms and 0% I/O, paid a second time on another table. Split back into `eventBuckets` (columns) and `eventBucketsByLevel` (jsonb), which is the honest shape: the two charts ask two different questions and the 8× is the difference. |
| | | Net, measured on 500k events: the page is **unchanged unfiltered** (13.43 → 13.40 ms) and **15% faster filtered** (18.12 → 15.44). Individual rollup reads pay ~30–65% for a table with twice the rows, and the page absorbs it. Also fixed in passing: `envCond` was a bare `environment = ANY(...)`, which never matches NULL — so selecting the `(unset)` pill that `environmentsInUse` offers emptied every widget and read as a quiet period. |
| 2026-08-25 | **The org overview and the project dashboard are one service stack.** `overview.service.ts` (699 lines) and `aggregations.service.ts` (600) are deleted, along with both caches, both range parsers and `aggregation-utils.ts` — eleven files in total | The request was that the two dashboards be one thing with the organization simply aggregating projects. That turned out to be literally true of the queries: every difference between the two services was **scope, a filter predicate, or a bucket width** — all parameters. Every query now takes `projectIds: string[]`; the project route passes `[id]`, the org route passes all of them. Three name changes follow from it, because `getOrgEnvironments` and `getProjectStats` describe a scope that is now an argument: `projectStats`, `topMessagePerProject`, `environmentsInUse`. |
| | | The merge kept finding defects that the duplication had hidden, which is the argument for having done it. The volume chart took **no environment argument at all**, so it ignored the filter bar — closed by the merge rather than scheduled, because the merged query had to carry the column anyway. `pickBucket()` drew **six points for a six-hour range** against the overview's twenty-four; nothing recorded that as a choice, it fell out of having four widths for six presets. And a regression guard named for the text-ordering defect **could never have failed**, because the counts it asserted on sort identically as text and as numbers. |
| | | The last of those was a key collision, found only because the two caches merged: they namespaced keys `overview.*` and `dashboard.*`, and that prefix was the **only** thing keeping two different questions apart — the dashboard asks `topMessages` for every level with limit 10, the overview for `error, fatal` with limit 5, and neither `levels` nor `limit` was in the key. A one-project organization and that project's dashboard would have been served each other's answers the moment the prefixes merged. Fixed by putting the distinguishing options in the key, not by keeping a prefix that encodes which page asked. |
| | | Cost paid in tests rather than saved: the two integration suites became one of 93, the twelve describes became fifteen, and each defect above got a test that was **mutation-checked** — broken deliberately to confirm it fails. That step is what turned up the dead guard, and it is now written into §17 as the cheap check for any test claiming to be a regression guard. |
| 2026-08-25 | **A regression guard for the text-ordering defect could never have failed**, and was found by mutation rather than by reading it | `overview.service.itest.ts` carried a test named *"orders by count numerically, not by the text of the count"*, whose comment stated it guarded against an alias sort ranking `"2"` above `"28"`. It asserted on `ORG_A_PROJECTS`, whose level counts are **28 / 20 / 2 / 1** — and descending text order on those four strings is `"28", "20", "2", "1"`, identical to the numeric order. The test held with the defect present. It was written the same day the defect was fixed, by someone who had just understood the defect, and it still measured nothing. |
| | | Found because the replacement was mutation-tested rather than trusted: reverting `ORDER BY SUM(n)` to `ORDER BY count` left the new suite fully green, which is not a result a working guard produces. The fix is scope, not assertion — `DASH` exists in the fixture precisely for this, with counts of **10 / 9 / 2** whose two orderings disagree on the *first* element, and its comment already says they "must not be tidied". The shared test now uses it. |
| | | This is the third entry in this log about the same class of problem and the second about a test that passed against broken code. `WORKFLOW.md` §2 already says a green hook means a file exists and imports something, not that it asserts anything true. What this adds is the cheap check that would have caught it: **for any test whose name claims it is a regression guard, break the thing it guards and watch it fail.** A guard that cannot be made to fail is not a guard. |
| 2026-08-25 | **The two bucketing rules are unified into one table, and `pickBucket()` is retired** — a change to what both charts show, taken deliberately rather than deferred again | `logging.md` called the disagreement "a wart rather than a design" and left it to this workstream because unifying it *changes what the chart shows*. That was the right call to defer and the wrong thing to keep deferring: the request driving this work is that the two dashboards be one thing, and that cannot survive them drawing different numbers of marks for the same window. Measured before deciding — `pickBucket()` is not a table but four width steps (1m/1h/12h/1d) selected by range length, so at 6 hours it lands on the 1-hour width and draws **six points**, against twenty-four on the overview for the same range. That is not a resolution trade-off anyone chose; it falls out of having four widths for six presets. |
| | | The replacement enumerates one width per preset per density, every cell landing between 12 and 60 points, with a test asserting the band rather than the values — a table nobody can read is the failure mode, and the band is the property. The two densities differ in **exactly one cell**, `1h`, which is the project dashboard's live minute-by-minute tail; a second test asserts that it stays the only difference, so a future edit cannot quietly reintroduce two rules under one name. |
| | | Deliberately *not* done in the same step: pointing `eventsPerMinute` at the table. It still calls `pickBucket()`, so the project dashboard has not yet gained the finer 6h and 7d charts. Splitting it that way keeps the parser consolidation independently revertible from the service merge, and the partial state is written into `architecture.md`, `logging.md` and the module's own doc rather than left for a reader to discover by comparing two charts. |
| 2026-08-25 | **Putting `environment` into `event_template_rollup` is dropped from the plan** — not deferred with a condition, dropped, because the measurement that was supposed to justify it argued against it | The plan agreed that day was to key both rollups by environment so that a filtered read stops falling back to raw `events`. Stage 0 measured it first, per the 2026-08-20 entry below requiring each stage to open with evidence. The two rollup-backed marginal queries behaved as predicted — `getProjectStats` 4.47 ms → 17.20 ms filtered, `getOrgLevelBreakdown` 7.16 ms → 15.36 ms — but the two **template-rollup** queries went the other way: `getProjectTopMessages` 22.25 ms → **16.18 ms**, `getOrgTopErrors` 25.43 ms → **17.29 ms**, and the whole page 24.53 ms → 18.78 ms. The filtered path that abandons the rollup is *faster* than the rollup path it abandons. |
| | | The mechanism is measurable and is the part worth keeping: `event_template_rollup` holds **204,437 rows for 500,000 events — 2.45 events per row**. Its grain is `(project, minute, template)`, so it folds anything only when one template repeats *within one minute*; at ~58 events/minute/project against 3,711 distinct templates, almost every event gets its own row. The affordability argument in `messageTemplates.ts` is about **table size** and it holds; it was read as though it were about **read cost**, which tracks rows scanned, and there it does not. Adding `environment` to that key would multiply a table that is not currently earning its place on this corpus. |
| | | What would reopen it: a corpus where the compression ratio is actually large — high events-per-minute against a bounded template vocabulary, which is what the staging figures assumed. The ratio is now cheap to check (`SELECT AVG(count) FROM event_template_rollup`), so the condition is a number rather than an opinion. `environment` in `event_rollup_minutes` stays in the plan: its regression is real, and the unified chart's error-ratio metric cannot be filtered by environment without it. |
| 2026-08-25 | The overview's environment filter felt slow because the **filter bar gave no feedback**, not because the query was slow; the optimistic-selection mechanism moves to `shared/hooks/use-filter-params.ts` | The complaint that opened this work was a long wait when switching environment. Four hundred lines of analysis went into which queries abandon the rollup under a filter — all of it accurate, none of it the cause. The page's whole fan-out is 19–25 ms on 500k events, and the installation that produced the complaint had **zero events in the selected range**. What it did have was `OverviewFilterBar` calling `router.push()` bare: no transition, no optimistic pill, so nothing on screen changed until the server answered. |
| | | This is the second time the same defect has been diagnosed in this codebase. The first was 2026-08-22, in `use-dashboard-range.ts`, from a complaint recorded there as *"the button does nothing"* — and the fix stayed private to `features/dashboard`, so the overview kept the defect for three more days. That is the argument for `shared/`: not reuse, but that a fix living inside one feature does not reach the other place that needs it. `useDashboardRange` is now a wrapper over the shared hook, and its eleven existing tests passed unchanged, which is what distinguishes this from a rewrite. |
| | | The lesson recorded deliberately: *the first hypothesis was that the environment filter was slow, and the benchmark said the opposite.* The benchmarks now measure filtered and unfiltered paths side by side (`overview.service.bench.ts`) so the next such claim has a number to be checked against before it becomes a plan. |
| 2026-08-24 | `getOrgTopErrors` moves to the template rollup, and its **last-seen timestamp becomes accurate to the minute rather than to the second** | The last read on either dashboard grouping raw message text, and the last holding `mode() WITHIN GROUP` — two of them. Both are replaced: the level badge by the `n_*` columns, and the representative project by a `ROW_NUMBER()` window over one row per (project, template) among the top N. Same answers, and neither is an ordered-set aggregate, which is what forbade `HashAggregate` at any `work_mem` and cost 9.8 s on this query's sibling. |
| | | The honest cost is in the timestamp. `event_template_rollup.latest_at` is the newest event for a template in a minute **across every level**, so a template appearing as `info` after its last `error` would report the `info` occurrence as when the error was last seen — and this widget renders that value as "time ago". Restricting the aggregate to minutes that actually contained an error (`MAX(latest_at) FILTER (WHERE n_error + n_fatal > 0)`) bounds the residual error at **60 seconds**: the case left is one minute holding both an error and a later info line. Chosen over a `latest_error_at` column because that column would need a third "is this row rebuilt yet" coverage mechanism alongside the two the rollups already carry, to buy sub-minute precision on a display that reads "4m ago". Written down because it is a real, if small, difference between the two implementations, and a reader comparing them will otherwise find it and assume it is a bug. |
| 2026-08-24 | **An organization with one event-free project loses both rollups entirely**, and the guard that causes it was documented as holding "by accident" four days before it stopped holding | `rollupBoundary` and `templateCoverageForProjects` return `null` — meaning "read everything from raw `events`" — when any project in scope has no `rollup_state` row. Migration 0008 seeded a row for every project that existed on 2026-08-20, and the only writer since is `markRollupDirty`, called **from ingest**. So a project created afterwards that has never received an event has no row, and drags the whole organization's overview onto the raw-text path. Staging has exactly one (`shahar`), which is why the §16.3 overview work shipped in `a1bdfda` has never actually executed in production. The guard is not wrong — it degrades safely instead of undercounting — but its own comment predicted this in writing: *"the correctness holds by accident of two other mechanisms rather than by anything here."* It stopped holding the first time somebody created a project, and "create the project, wire up ingest later" is the normal first-run flow, so **every new install starts on the slow path by default**. The fix, shipped the same day, is to ask a better question rather than to keep a second table populated: a project with no events contributes zero rows to the rollup *and* zero to raw `events`, so it cannot undercount anything — the guard now separates "no watermark and no events" (harmless) from "no watermark but has events" (the real hazard), via an `EXISTS` on `(project_id, timestamp)`, the 0.79 ms `hasAnyEvents` shape. No schema change and no migration. Writing the test first turned up a **second** inheritance hole in the same file: `templateCoverageForProjects` filtered on `templates_rolled_up_to` alone, so a project with a ceiling and no floor would have been handed another project's floor and declared covered from a moment it was never summarised. Unreachable through the job, which writes both ends in one statement — that is a *second* mechanism holding this one correct, which is precisely the arrangement that produced the original bug, so it is now checked rather than relied on. It all stayed hidden because it is nearly free today: the fallback costs 68 ms + 55 ms now that the host is sized. It gets expensive with the corpus, not with time. |
| 2026-08-24 | `topSources` finally has the 30-day number its `by_source` deferral asked for — **1,207 ms mean at 41% I/O, the page's leader by 50%** | The 2026-08-21 entry deferred a `by_source` rollup column and named the condition to revisit: *"it should be a number measured at 30 days rather than a wish for a tidy table."* Measured on the resized host: `topSources` is the slowest query on either page and **the only one reporting meaningful `blk_read_time` at all** — every rollup-backed read is at 0%. That is the same finding twice, since it is also the only read still scanning raw `events` across the full range. The deferral's condition is met, and it **shipped the same day** (migration 0013) once the decision was taken to finish Postgres rather than move. jsonb marginal, not a key column, capped at 20 like `by_env` — `source` is client-supplied, so a row-per-value key would let a project inventing a source per deploy multiply the table. The awkward part is the transition, and it is worth recording: existing rows get `'{}'`, and an empty object is distinguishable from a real result because every event has a source or `(unknown)`, so a rebuilt row always carries at least one key. `topSources` therefore checks `MAX(minute) WHERE by_source = '{}'` and falls back below it — exact rather than conservative, because those rows form a contiguous band that the job refills oldest-first. Short ranges work the moment the deploy lands, long ones heal as the rebuild advances, and no window exists in which the widget is wrong. The migration pulls `refresh_from` back to trigger that rebuild but deliberately does **not** reset `rolled_up_to`: that watermark governs the level rollup, which is complete and correct for these rows, and resetting it would send every dashboard to raw `events` for half an hour to fix a column none of them read. |
| 2026-08-24 | `event_template_rollup.by_level` being **jsonb was a mistake of symmetry**, and the measurement now says so | It is jsonb to match `event_rollup_minutes.by_env`, whose jsonb form is genuinely load-bearing: `environment` is client-supplied and a row-per-value key would let a client multiply the table without bound. **`level` has none of that property** — it is a closed set of five, the one dimension in the whole inventory that can never explode. So the reasoning that justified jsonb for `by_env` was copied to a column it does not apply to. The cost is now visible: reading it means `FROM event_template_rollup r, jsonb_each_text(r.by_level) l`, which multiplies every row by up to five and parses JSON per row, and the widget it feeds measures **804 ms at 0% I/O** — entirely CPU, so no amount of memory helps it. Five `int` columns would remove the lateral, the JSON parse and the row multiplication together. **Done the same day** (migration 0012), once the decision was taken to finish Postgres rather than move: five `GENERATED ALWAYS … STORED` `int` columns beside the jsonb, so the job still writes only JSON and the two cannot drift — the arrangement `event_rollup_minutes.errors` already used. The jsonb is kept rather than replaced: it is what the job writes, dropping it would need a backfill, and it stays the honest shape if a sixth level ever appears. Recorded because the *reason* is the point — a design rule was applied outside the conditions that make it true, which is how symmetry costs more than it saves. |
| 2026-08-24 | The staging host is **resized before any further read-path work** — 2 shared vCPU / 4 GB / 120 GB → 4 vCPU / 8 GB / 240 GB | Two weeks of read-path optimisation never once checked how much memory the host had. It had 4 GB, shared with the app, the worker, Caddy and the backup container, against an `events` table already past 9.6M rows — and Postgres was running `shared_buffers=128MB`, its stock default. `topMessages` measures 17,021 ms for work whose hash aggregate should cost 1–2 s with its input in cache. **That ten-fold gap is the shape of a working set that does not fit in memory** — an inference when this was written, and `track_io_timing` shipped in the same change to test it. **Measured the same evening, and it holds with one correction.** On the resized host every rollup-backed query reports **0% of its time in `blk_read_time`**; the single exception is `topSources`, the one read still scanning raw `events` across the whole range, at **41%**. So the mechanism is confirmed in the direction that matters — rollup reads are memory-resident and CPU-bound, raw-range scans are disk-bound — but note what cannot be shown: `track_io_timing` was **off** before the change, so there is no "before" I/O number and the old 17 s was never measured as disk-bound, only inferred. What is unconfounded is `topSources`, whose SQL is byte-identical across `v0.5.1..v0.6.0`: **10,713 ms → 775 ms**, roughly 14×, from hardware and configuration alone. Recorded because the ordering was wrong: every §16 measurement to date was partly measuring the droplet, so any of them could be re-read as evidence about architecture when some of it was evidence about RAM. Chose 4 vCPU over the same-RAM 2 vCPU option at +$16/month because adding memory *moves* the bottleneck from disk to CPU rather than removing it, and the box also runs SSR, the worker and continuous ingest on the same cores. The disk (240 GB vs 160 GB) is the difference between fitting and not fitting around 100M events. |
| 2026-08-24 | Postgres gets a **sized configuration profile**, closing §16.1 Stage C, with the values in `.env.production.example` and the compose fallbacks left stock | Stage C deferred this until it could be measured on the real host, which was right, and then the deferral outlived its reason: the install shipped and kept running on upstream defaults. Two of the ten settings are worth their own note. **`work_mem=32MB`** is sized to the largest GROUP BY we intend to keep — topMessages off the template rollup is ~18k groups ≈ 5 MB — and *deliberately* leaves the 1.13M-group raw-text fallback spilling, because sizing for that query means sizing for the one §16.3 exists to retire; the 2026-08-22 entry below already established that removing its spill bought 7%. **`jit=off`** is the non-obvious one: `events` is pg_partman daily-partitioned, so a 30-day plan carries ~30 scan nodes, and JIT admits itself on the query's total cost then compiles per expression across every node — paying compilation proportional to a partition count the threshold never considered, on queries bound by bytes read rather than expression evaluation. The fallbacks in both compose files stay at Postgres 16 stock, because a compose file cannot know its host and a default sized for ours would be wrong everywhere else; `db/postgres-tuning.test.mjs` holds the three files to agreeing. `track_io_timing` and `log_temp_files` are instruments rather than tuning — they change no plan, and their absence is why every measurement before this one could show that a query was slow but not whether it was waiting on disk. |
| 2026-08-24 | ClickHouse **revisited and deferred again** — and the 2026-04-29 entry's reasoning no longer holds, only its conclusion | Re-examined seriously: the case for it is not volume but that ~2,008 lines of this repository's most delicate code (two rollups, two watermarks, a coverage interval, template fingerprinting, union-with-raw-tail, a backfill script) exist solely to work around row-oriented storage, and nearly every one has produced a silently wrong answer at least once. A columnar store needs none of it, and its materialized views are maintained by the database rather than by a job with a watermark. What defers it is the host, not the argument: on 4 GB shared with two other services, a memory-starved ClickHouse is worse than a well-fed Postgres, and its main weapon — parallel vectorised scan — has nothing to run on. **The 2026-04-29 rationale ("1M/day fits Postgres; CH adds ops cost without payoff at this scale") should not be cited as if it still applies**: retention is becoming per-organisation, so the volume is no longer bounded at 30 days by design, and the target was revised to "maybe 10M, maybe 300M". At 300M, Postgres does not fit in 240 GB at all while ClickHouse would compress to roughly a tenth. Named triggers, so this is falsifiable rather than perpetual: 30-day reads still measured in seconds *after* the resize and the tuning; a decision to keep raw events beyond 90 days; or confirmation that the target is nearer 300M than 30M. **The first did not fire, and not narrowly**: with the rollup finished on 2026-08-24 a cold 30-day dashboard is **437 ms**, its slowest query 181 ms, and the range barely moves it — 24h, 7d and 30d land within 45 ms of each other. So the performance case is closed on the evidence, and what remains open is entirely the product question below: per-organisation retention, and whether long retention keeps raw events or only aggregates. The evaluation, when it happens, is a day of loading a staging dump into a ClickHouse container and re-running three queries that already have Postgres numbers — not a migration. |
| 2026-08-24 | Promoting `environment` from a `by_env` marginal into the **rollup key** is designed, agreed, and **frozen** | It is the right shape and it closes all three "falls back to raw `events` when an environment filter is active" holes at once — level breakdown, org top errors, per-project top message — which were found separately and are one missing key column. The general rule it establishes: **a dimension enters the key if a filter in the UI uses it, and enters as a marginal if only a widget groups by it**; key dimensions conjoin with everything, marginals conjoin with the key but not with each other. Frozen anyway, because it is a week of work restructuring both rollup tables, and the entry above may delete both. Unfreezing is whichever way the ClickHouse triggers resolve. `getOrgTopErrors` — still on raw text with two `mode() WITHIN GROUP` calls — is frozen with it, for the same reason: migrating it now means migrating it twice. |
| 2026-08-23 | The template fingerprint is **added beside** the raw message, never substituted for it | The cheaper design stores only the template and drops `sess_ai6h2q` at ingest. It was rejected because normalising is a heuristic over regular expressions that will sometimes be wrong, and ingest is a one-way door: a bad rule discovered next week would have destroyed data that cannot be recovered. Storing both costs 8 bytes a row — 3.1% of a 255-byte heap row, ~1.5% of total size, ~0.6 GB at a 30-day steady state of 38 GB — and buys the ability to fix a rule by bumping `NORMALIZER_VERSION` rather than mourning it. It also keeps the events list showing what was actually sent, which is what someone debugging one event needs, while the widget groups by shape. Sentry and Datadog both do it this way; the version that rewrites your logs is not a version anyone ships. |
| 2026-08-23 | The template rollup uses **minute** grain, like the level rollup, decided on a measurement rather than symmetry | Hour grain is six times smaller — 850 rows/hour against 5,344 measured on staging — and both are trivial against `events` (60 MB versus 385 MB, on a table heading for 38 GB). What decided it is the **raw tail**: reads take the rollup below the watermark and raw `events` above, so grain sets the size of the uncovered window. At minute grain that is ~1,900 events; at hour grain up to ~114,000 on *every* read. Short ranges are the common case — 1h is the default and returns in 240 ms — and that is exactly where a large tail dominates. Minute grain also means one watermark, one job and one read pattern instead of two, which is the same argument that put the rollup on the dashboard in the first place. |
| 2026-08-23 | Template rollup coverage is stored as an **interval**, not a watermark, and this cost a second migration | `templates_rolled_up_to` alone was the obvious design and it is wrong. The level rollup can summarise any event, so its coverage is a prefix and one watermark describes it. The template rollup can only summarise events carrying a `template_hash`, and nothing ingested before that column shipped has one — so coverage has a floor as well as a ceiling. A reader holding only the ceiling takes a 7-day range, sees it ends below the watermark, reads the rollup for all of it and silently misses every pre-deploy event: on "top messages", indistinguishable from a message nobody sent. Migration 0010 adds `templates_rolled_up_from`, which moves backwards only, so a catch-up run rebuilding an older window widens the interval instead of claiming a prefix it never had. Found while writing the job, not while designing the schema. |
| 2026-08-23 | The raw-text `topMessages` is **kept**, not replaced | It is the only implementation that can answer for events with no fingerprint, and every range reaching back before the deploy takes it. That is not a rare edge: it is every 7-day and 30-day read for the first weeks, and it stops being needed only when 30-day retention rolls the pre-deploy events out. Deleting it the day the rollup works would have silently returned a top-messages list missing everything older than the release — the failure this whole entry exists to prevent. Two implementations of one question is a cost; a silently short answer is worse. |
| 2026-08-22 | **`message` is the name of an event; variable data belongs in `attributes`** | Arrived at from a performance problem and kept for a product reason. `topMessages` groups raw text, and on staging that is 1,133,715 groups over seven days — `Session sess_pw62y expired` is a unique string that is also the same event forty thousand times. Sentry and Datadog both collapse the variable parts into a template, and it is the only shape that scales: cost then tracks the number of *kinds* of message, not the number of events. But the stronger argument is that the templated form is **what a reader actually wants** — "sessions expired 40,000 times", not forty thousand session identifiers ranked by frequency. The objection to normalising ("I need to know *which* session") does not survive contact with this product's own data model: events already carry typed `attributes` with a registry enforcing their types, so `sess_pw62y` belongs in `attributes.session_id`, where it is filterable, rather than melted into prose where the only available operation is reading it. Adopting the rule costs nothing today — it is documentation and ingest guidance — and it is the precondition for a template rollup keyed by hash instead of by text. Recorded as a rule rather than a task because it changes what we tell users to send, and every day it is not written down is another day of data that cannot be grouped. |
| 2026-08-22 | `work_mem` is **not** the read path's problem, and the measurement that looked like proof was a symptom | The 4 MB default made `topMessages` spill ~250 MB to disk, which is exactly what a superlinear jump against data volume looks like. Removing the spill entirely bought **7%** (28,991 → 26,855 ms), and 512 MB made it **worse** (37,670 ms) through memory pressure on a 4 GB host. Written down because the hypothesis was stated confidently, the disk numbers appeared to confirm it, and it was wrong — the ladder took ten minutes and would have taken a deploy and a week of believing the wrong thing. The real lock was `mode() WITHIN GROUP (ORDER BY level)`: an ordered-set aggregate forbids `HashAggregate` outright, which the plan proves by taking a ten-billion sort penalty under `enable_sort=off` and sorting anyway. |
| 2026-08-21 | `shared/services/` revived for the rollup boundary, rather than copying it into the second reader | Both dashboards read `rollup rows below a watermark UNION raw events above it`, so both need the watermark. The alternative was a second implementation, and by this point the day had produced three separate cases of exactly that going wrong — a Zod enum that lost `5m`, three preset lists, four copies of one option array. `shared/services/` is what `PROJECT.md` §2.1 prescribes and had been empty since 2026-08-13 only because its last occupant was dead code. The move also fixed something the private copy had: `MIN` and the NULL filter both ignore rows that are *absent*, so a project missing from `rollup_state` inherited another project's boundary and then contributed no summary rows below it — an undercount that reads as a quiet project. It cannot happen today, because `markRollupDirty` writes a row on every ingest and migration 0008 seeded one per project; that is the problem, and the guard is one comparison. |
| 2026-08-21 | The dashboard's rollup tests live in `event-rollup.service.itest.ts`, **not** beside the service they cover | Colocation is the rule (`PROJECT.md` §11) and this is a deliberate exception with a reason that outranks it. `aggregations.service.itest.ts` runs against the shared fixture, which inserts events with direct SQL and never builds a rollup — so `rollupBoundary` returns null there and every read falls back to raw `events`. Tests written next to the service would have passed without executing a single line of the rollup branch, which is the precise failure this repository already recorded twice: a test file named after a service it never imported, and three tests that passed against broken code. `event-rollup.service.itest.ts` owns a project and rebuilds the rollup for real. Verified by breaking the rollup CTE on purpose and confirming exactly one test failed. |
| 2026-08-21 | The project dashboard was double-refreshing itself, found while converting `DashboardPage` to a Server Component | `DashboardPage` called `useAutoRefresh()` and also rendered `DashboardHeader`, which renders `AutoRefreshControl`, which calls `useAutoRefresh()`. Two intervals, two `router.refresh()` per tick: the page reloaded twice as often as the setting said, doubling its own database load — on the page this workstream exists to make cheaper. Logged because of how it was found. Nobody was looking for it; it fell out of asking which hooks had to move when the component stopped being a client component, and no test in this repository could have caught it — there are zero `.test.tsx` and a duplicated `setInterval` is invisible to every other kind. The structural fix is that a Server Component cannot hold a hook at all. |
| 2026-08-21 | `hasAnyEvents` is the one dashboard read left **uncached** | Everything else on the page is cached for 30 s. This gates which page renders — the dashboard or the onboarding screen — and its answer changes exactly once in a project's life, when the first event arrives. That is the single moment a stale "no events yet" would be worst, and it is also the moment a user is most likely to be watching. It costs 0.79 ms. Caching it would trade the page's most user-visible correctness property for a fifth of a millisecond. |
| 2026-08-21 | The project dashboard adopts the rollup **even where the benchmark shows no latency win** | Measured, the three rollup-servable queries cost ~55 ms and run in parallel with a 170 ms `topMessages`, so removing them entirely moves the fan-out by zero. Two things override that. First, the 0 ms was measured over a **24-hour window on a three-day corpus**: `eventsPerMinute` scans raw events in proportion to the window, while the rollup form reads 43,200 per-minute rows regardless of range — so at 30 days of data the gap is real and the measurement simply could not see it. That caveat was raised repeatedly about other people's numbers and missed in our own, which is the reason it is written down here. Second, and not a number at all: **one read pattern instead of two.** Not every query moves — `topMessages` is barred by cardinality, `recentErrors` returns rows — so what becomes uniform is the rule, "rollup plus raw tail where the dimension is stored, raw events where cardinality forbids", which holds on both pages. Two pages with different rules is how this repository acquired three copies of a preset list and a test named after a service it never imported. Cheap besides: the table, the job and the boundary logic all exist, and `by_level` already holds what these three need, so there is no migration. |
| 2026-08-21 | `topSources` does **not** get a `by_source` rollup column yet | Symmetry argues for it and the measurement does not: 11 ms, hidden behind a 170 ms query. `source` is safe by cardinality — app-defined and bounded, unlike `message` or `release` — so this is a deferral, not a refusal. But a `by_source` column is width added to every row of every minute of every project, permanently, and that is paid whether or not anyone opens the dashboard. Its scan cost grows with the window on the same reasoning that justifies the other three, so the answer may well become yes; it should be a number measured at 30 days rather than a wish for a tidy table. |
| 2026-08-21 | The serialised `hasAnyEvents` gate stays where it is | Predicted, out loud, to be a significant part of the dashboard's latency because it is awaited *before* the fan-out rather than inside it. Measured: **1.2 ms** of a 170 ms page, 0.2%. Moving it would be measuring noise. Recorded rather than quietly dropped, because the prediction was stated as a reason to act before anything was measured, and the discussion gate exists precisely to catch that. |
| 2026-04-29 | Postgres over ClickHouse | 1M/day fits Postgres; CH adds ops cost without payoff at this scale. **Conclusion still stands as of 2026-08-24; this rationale does not** — see the 2026-08-24 entry at the top of this table for what actually holds it in place now, and for the triggers that would flip it. |
| 2026-04-29 | Drizzle over Prisma | Lighter runtime, better TS, project preference |
| 2026-04-29 | better-auth over Auth.js v5 | Better RBAC ergonomics, modern API |
| 2026-04-29 | pg-boss over Redis-based queue | One less infra component |
| 2026-04-29 | Owner as flag, not role | Prevents accidental loss of org-delete capability |
| 2026-04-29 | No live-tail / SSE | User confirmed polling is enough |
| 2026-04-29 | No error grouping in MVP | Reduces scope; can add later behind feature flag |
| 2026-04-29 | No SDK clients now | Plain HTTP ingest is enough for MVP |
| 2026-04-29 | Self-hosted Docker | Internal tool, not on Vercel |
| 2026-04-29 | Threshold-only alerts | Covers ~80% use cases at fraction of complexity |
| 2026-04-29 | Webhook-only notifications in MVP | Zero external dependencies; covers Slack/Discord/Telegram bots/custom endpoints |
| 2026-04-29 | `pg_dump -Fc` nightly backups | DB stays small (~5 GB compressed); pgBackRest deferred to >50 GB or PITR need |
| 2026-04-29 | Caddy over Nginx | Single domain, auto Let's Encrypt, minimal config |
| 2026-04-29 | No Prometheus in MVP | App is itself an observability tool; pino stdout logs sufficient until scale demands metrics |
| 2026-04-29 | Worker as separate container | Cleaner restarts, independent scaling for ingest/alerts |
| 2026-04-30 | Per-feature doc + PROGRESS.md | Single PLAN.md would balloon past usability; per-feature docs mirror FDD code structure and survive context resets |
| 2026-04-30 | Foundation as standalone feature 00 | Self-contained checkpoint: app boots and `/api/health/ready` works regardless of business features |
| 2026-04-30 | No email verification (Q-A1) | Invite-only signup means email is verified by receiving the link |
| 2026-04-30 | No 2FA in MVP (Q-A2) | Internal tool; can add later as security feature |
| 2026-04-30 | 30d rolling session, no remember-me toggle (Q-A3, Q-A4) | Internal tool; reduce login friction; keep one model |
| 2026-04-30 | Setup wizard at `/setup` (Q-A5) | User-friendly bootstrap; no CLI/env-var required; auto-disabled after first user |
| 2026-04-30 | Copy-link invitations in MVP (Q-A6) | No email provider yet; webhook hookup later without schema changes |
| 2026-04-30 | Theme: dark/light/system in UserMenu (CC1) | Default `dark`. Persisted in `users.preferences`. Anonymous users follow system. |
| 2026-04-30 | English-only with typed dictionary (CC2) | Strings in `core/i18n/dictionary.ts` from day one; multi-lang switch is mechanical later. |
| 2026-04-30 | UTC in DB, local TZ in UI (CC3) | `timestamptz` columns; `Intl.DateTimeFormat` for display; UTC tooltip on hover. |
| 2026-04-30 | No audit log in MVP (CC4) | pino structured logs cover internal traceability. |
| 2026-04-30 | Rate limiting only on auth and ingest (CC5) | better-auth + custom ingest middleware; no other rate limits. |
| 2026-04-30 | CORS allow-all on ingest (CC6) | API key is the security boundary. |
| 2026-04-30 | No onboarding tour | Empty states + CTAs are enough; docs cover the rest. |
| 2026-05-01 | Setup wizard guarded by advisory lock + COUNT(users) inside transaction | Middleware check is racy; without DB-level guard two simultaneous /setup submits both create owners. See feature 01. |
| 2026-05-01 | `users.preferences` writes use jsonb `\|\|` merge, never full replace | Multiple features extend this jsonb; naive replace silently wipes sibling keys. See feature 01. |
| 2026-05-01 | FK cascades pinned per-table (CASCADE / RESTRICT / SET NULL) | Predictable delete semantics; org-delete wipes membership but not events; events block hard project-delete; audit refs survive user deletion. See per-feature schema sections. |
| 2026-05-01 | pg-boss schedules use singletonKey + worker pinned to replicas=1 | Two safeguards against double-execution of cron jobs (alert eval, partman maintenance) during rolling restart. See features 03, 06, 08. |
| 2026-05-01 | Optimistic concurrency on `alert_rules.version` | Evaluator must not commit notifications based on a filter the user just edited. See feature 06. |
| 2026-05-01 | Soft-deleted projects: events stay until partition drop, no archive UI | Events query JOINs projects + filters `deleted_at IS NULL` as the canonical access boundary. See features 02, 04, 06. |
| 2026-05-01 | partman migration is idempotent (`DO $$ ... IF NOT EXISTS ... $$`) | Drizzle migrate may re-run; second `create_parent` would otherwise fail. See feature 03. |
| 2026-05-01 | Filter parser strips invalid keys instead of erroring the page | Stale share links / typos shouldn't break the screen. See feature 04. |
| 2026-05-01 | `useEventFilters` resets cursor on every filter change | Stale cursor against new filter set yields confusing empty results; centralized in the hook. See feature 04. |
| 2026-05-02 | Design system + UI kit as side track, not numbered feature | Cross-cutting infra used by all features; runs interleaved with Foundation. Tracker: `docs/features/design-system.md`. |
| 2026-05-02 | Dark color tokens emit under `:root, [data-theme="dark"]` (shared block); light is full override | Page renders correctly in dark even before the no-flash inline script (foundation step 37). See `docs/features/design-system.md`. |
| 2026-05-02 | Bare SCSS imports via `sassOptions.loadPaths = [process.cwd()]` | Mirrors TS `@/*` alias inside `.scss` files; avoids `../../../` chains. See `next.config.ts`. |
| 2026-05-02 | `@floating-ui/react` for anchor-positioned overlays (Tooltip, Popover, future Combobox/Menu) | Industry standard, flip/shift/arrow/focus built in. Hand-rolling collision detection is the wrong tradeoff at this scope. ~10 KB gzip. |
| 2026-05-02 | Modal uses native HTML `<dialog>` instead of custom portal/focus-trap | Browser handles focus trap, escape, top-layer stacking, `::backdrop`. No third-party focus-trap lib. See feature 'design-system'. |
| 2026-05-02 | Toast state in Context (not Redux) for now | Foundation hasn't installed Redux yet; toast queue is isolated UI state, not domain data; refactor to Redux later if shared with other UI is straightforward. |
| 2026-08-13 | Nonce-based CSP minted in `proxy.ts`; static headers in `next.config.ts` | Nonce + `strict-dynamic` is real XSS protection, unlike `script-src 'unsafe-inline'`. Splitting them keeps the per-request part where a per-request secret can be generated. |
| 2026-08-13 | `style-src` keeps `'unsafe-inline'` and will not be tightened | Per the CSP spec a nonce in `style-src` makes the browser *ignore* `'unsafe-inline'`, and nonces never apply to inline `style` **attributes** — which Recharts emits on all its SVG. Nonce-ing styles blanks every dashboard chart. Scripts stay fully nonce-covered. |
| 2026-08-13 | Accept a fully dynamic app as the price of the nonce | Root layout reads `headers()` for the nonce, opting the whole tree into dynamic rendering; `next build` reports zero static routes. Free for a self-hosted single-tenant app. Revisit only if CDN caching is ever wanted — the two are mutually exclusive without dropping the nonce. |
| 2026-08-13 | Webhook SSRF guard in two layers, DNS re-checked per delivery | Save-time validation alone is bypassable: a hostname that resolves publicly when the rule is saved can be repointed at `169.254.169.254` later. Syntactic layer is isomorphic (runs in the editor form), DNS layer is server-only. Redirects are refused outright rather than followed. |
| 2026-08-13 | Operational env vars moved into the validated schema (4 → 8) | `LOG_LEVEL`, `WORKER_IN_PROCESS`, `RATE_LIMIT_PER_MIN`, `ALLOW_PRIVATE_WEBHOOK_TARGETS` now fail fast at boot. `AUTH_SECRET` raised from `min(1)` to `min(32)`. Precipitated by `NEXT_PUBLIC_APP_URL` — an env var referenced in code but defined nowhere, which silently broke every alert webhook's deep link. |
| 2026-08-13 | Mount gates use `useSyncExternalStore`, not `useState` + `useEffect` | `react-hooks/set-state-in-effect` correctly flags the old idiom as a cascading render. Extracted to `shared/hooks/use-is-hydrated.ts`. Dialog state resets moved to React's documented "adjust state during render" pattern for the same reason. |
| 2026-08-13 | App container listens on **3000**, not the 80 used by `npm run start` | The image runs `.next/standalone/server.js`, which reads `PORT` — it never runs `next start`, so the npm scripts' `-p 80` does not apply. A privileged port buys a proxied backend nothing while making the non-root `node` user depend on Docker's `ip_unprivileged_port_start=0` default. Pinned in one place (`ENV PORT`) and referenced by the Caddyfile and the compose healthcheck. See §15.1. |
| 2026-08-13 | Caddy adds **no** security headers; the app is the single source | A browser enforces every CSP header it receives, and the proxy cannot know the nonce (generated inside the app, after forwarding). Any proxy-side policy blocks the nonced inline scripts Next uses to boot the client — a page that renders but is inert. The `Caddyfile` states this where someone would add a `header` block. See §15.1. |
| 2026-08-13 | `NODE_ENV=production` baked into the image, not left to `env_file` | `next build` bakes production behaviour into the app bundle, but `worker` and `migrate` are plain `node` with no framework to default it — unset, they take development branches (the pooled-client global in `core/db/client.ts` among them). One image-level `ENV` covers all three processes; an env-file entry would be one more thing to forget. |
| 2026-08-13 | Worker and migrate bundled with esbuild, dependencies **inlined** | `next build` only compiles what is reachable from `app/`, so neither entrypoint exists in `.next/standalone`. `--packages=external` would have made them depend on Next's file trace happening to include their dependencies — a worker-only dependency added later would then fail at runtime, in production, with no build-time signal. Inlining costs ~2.5 MB and removes the failure mode. |
| 2026-08-13 | Migrations run via drizzle-orm's programmatic migrator, not `drizzle-kit migrate` | Keeps dev dependencies out of the runtime image: drizzle-kit carries its own esbuild and TypeScript, and reads `drizzle.config.ts`, which wants `dotenv` and a `.env.local` no container has. Both write the same `drizzle.__drizzle_migrations` table, so they stay interchangeable. Deviates from feature 08 step 9. |
| 2026-08-13 | Restore drops and recreates the database rather than `pg_restore --clean` | `events` is declaratively partitioned and each partition's primary key is an *inherited* constraint Postgres refuses to drop directly; `--clean` aborts partway through the drop phase. Found by actually running a restore, which is the only way this surfaces. The dump carries the `drizzle`/`pgboss` schemas and the pg_partman extension, so an empty target needs no hand-preparation. |
| 2026-08-13 | Production compose declares `name: logger-prod`; the dev file keeps the default | Both otherwise default to the folder name and share a namespace — running production in a developer checkout recreates the dev Postgres container and points production at the dev data volume (observed, not theorised). The dev file is left unnamed so existing checkouts keep their `logger_postgres_data`. |
| 2026-08-20 | `getProjectSummaries` split into `getProjectStats` and `getProjectTopMessages` — **a latency change that makes nothing faster** | The two halves cost ~30 ms and ~954 ms and were one function behind one promise, so every consumer of the cheap half waited for the expensive one. The KPI row is the clearest case: four numbers, all rollup-backed, all a few milliseconds old, rendered a second late because the same promise also carried a message aggregation the row does not display. Measured after the split, the page issues the same 10 SQL statements and `rollupBoundary` still runs 3 times — no query got faster and no query was removed. What changed is what has to finish before the page has something to show. Worth logging because the instinct on a slow page is to attack the slow query, and here the bigger win was available without touching it. The same mistake one level up was Stage D's `Promise.all`; this was the same shape hiding *inside* one of the boundaries that fixed it. |
| 2026-08-20 | The streaming top-error cell is a **Server Component passed as a prop** into a client component, not `use()` on the client | `ProjectsSection` is a client component because the Cards/Table toggle is `useState`, so a server `<Suspense>` cannot be written inside it. Two ways out: pass the promise down and unwrap it with `use()` in a client component, or render the cell on the server and hand it over as a `ReactNode`. The second keeps the query, the awaiting and the boundary on the server, where the promise already lives, and needs no client code at all — the framework documents it as the slot pattern. It costs two slot maps, one per view, because the two clip the message differently and only one is mounted at a time; both share a single promise, so that is extra elements in the payload and not a second query. |
| 2026-08-20 | The org overview's **level filter was removed**, rather than made to work everywhere | It reached three of the page's eight widgets — the KPI row, the per-project stats, org-wide top errors — and left five visibly unchanged: the volume chart ignores level filters by construction, the level breakdown is *about* levels so narrowing to one would empty it, and the per-project top message never received the filter at all. A control that moves three things and leaves five alone does not read as a filter with a documented scope; it reads as broken. The alternative was making it reach all eight — teaching the volume chart to read `by_level` from the rollup and fixing the top-message defect — which is real work in service of a control nobody asked to keep, and the same drill-down already exists per project on the events page where filtering applies to everything on screen. Removal deleted a known defect and one of the two documented asymmetries as a side effect, rather than requiring them to be fixed. Reopen if someone actually wants org-wide level narrowing; the answer then is all eight widgets, not three. |
| 2026-08-20 | `getOrgTopErrors` no longer takes a caller-supplied `levels` list; `error, fatal` is fixed | The parameter existed only for the level filter above. Left in place it would be a widget labelled "top errors" that any future caller could ask for debug lines — a defect waiting for a second caller, and one nothing would catch, since the function would be doing exactly what it was told. Dead parameters on a public service function are not free: they are documented capability. |
| 2026-08-20 | `AutoRefreshControl` and `use-auto-refresh` moved to `shared/`; i18n keys moved from `events` to `common` | They lived in `features/events/` while `features/dashboard` imported them across the feature boundary, and adding the overview as a third consumer made the shared home unavoidable. The i18n move is the same rule in another medium: a shared component reading `t("events.…")` couples every consumer to one feature's dictionary. **What makes this worth logging is what auditing it turned up: the tree holds 54 cross-feature imports in non-test source, across 19 pairs, `dashboard → events` alone accounting for 14.** So the tidy story — one arrow looks like an exception, three look like a missing `shared/` module — is not what happened; 54 arrows had already failed to force anything. §2.1 has no mechanical enforcement, so it is obeyed when someone happens to look. The fix that would change that is an import-boundary lint rule, not another worked example. |
| 2026-08-20 | The overview's read path is fronted by an **in-process cache**, and that was chosen over making the remaining queries fast | The target changed from "one reader" to 50–100 concurrent dashboards, and that is not a difference of degree. At ~2 s of database CPU per load, 100 readers on a 30-second refresh is ~6.8 cores for **one answer computed two hundred times**; reducing the two message-keyed queries to zero would still leave ~0.29 cores, and 200 identical computations a minute — at 1,000 readers that same residue is ~2.9 cores. Per-reader querying is not a slow architecture at that scale, it is the wrong one, so the first move had to be computing once and sharing. The rollup is what made that possible — not through its 4× speedup, which is irrelevant at a hundred readers, but by making the numbers identical across readers, which is the precondition for sharing them at all. This does **not** retire the message-keyed aggregations: a cache bounds how often an expensive query runs, never what it costs, and at 30 days of data they will still be paid once per TTL. |
| 2026-08-20 | Own ~70-line cache in the service layer; **rejected** `use cache` (Cache Components) and `unstable_cache` | The deciding factor is that the cache key is an authorization boundary: omit the project scope and one reader is served another's projects, with no error to notice. `use cache` derives its key implicitly from "arguments and closed-over values", so that boundary would rest on a framework convention rather than on something this repository can assert; a hand-built key is a pure function with tests on scope separation. Second, `cacheComponents: true` is a **global** flag that enables PPR app-wide and turns every unwrapped runtime-data access into a build error — a migration across every cookie-gated route, inside a change whose purpose is a read-path fix. `unstable_cache` costs the same effort as writing our own while Next 16 explicitly documents it as replaced. Not a permanent rejection: a service-level cache does not block adopting Cache Components later, when it is not an all-or-nothing switch. |
| 2026-08-20 | The cache is **per process**, and the no-Redis decision stands | At one deployable and ~100 readers, a per-instance cache costs one recomputation per instance per TTL — nothing. An external store would buy a shared hit rate the arithmetic does not need, and would reintroduce exactly the infrastructure component pg-boss was chosen to avoid (2026-04-29, above). Revisit when the instance count makes per-instance recomputation stop being free, not before. |
| 2026-08-20 | The cache key carries the range **preset**, never a resolved range | `resolveRange()` returns `to = new Date()`, so a resolved range makes every key unique to the millisecond and the hit rate exactly zero. That failure is silent in the worst way — the cache is present, correct, exercised by tests, and does nothing at all. The route resolves the range and passes both; the range is captured in the compute closure, so a background refresh uses one resolved microseconds earlier rather than a stale one. |
| 2026-08-20 | **The storage engine decision is deferred until the install carries 1M+ events.** Postgres stays for now | Three options were weighed — hand-rolled rollup tables, TimescaleDB, ClickHouse — and a fourth (metadata to MongoDB) rejected outright as solving nothing that is slow while adding a second datastore, cross-store joins in application code, and no transaction boundary. Deferring is unusually cheap **here**: `events` is append-only with 30-day retention, so the entire dataset self-expires and a migration is dual-write plus one month of waiting, with no backfill, ever. What does get more expensive with delay is not the data but the **read-path code** — eight dashboard widgets today, thirty later, each written against concrete SQL. Hence §16.1 Stage D/E: the work there survives any engine choice. Revisit when volume, not opinion, forces it. |
| 2026-08-20 | Each stage of the §16.1 workstream **opens with a discussion**, not with the previous stage finishing | The ordering was derived from a single afternoon of measurement, on one host, at one data volume, with Postgres untuned. Every stage produces evidence capable of invalidating the ones after it — Stage C in particular may show that the ranking in Stage D/E is wrong. Treating a finished stage as authorisation to start the next converts a measured plan back into a guess. |
| 2026-08-20 | Streaming is done by **passing unawaited promises from the route**, not by letting each section fetch its own data | The obvious way to split a page for `Suspense` is to move each query into the component that draws it. Here that would have been a regression: the bucket query feeds two sections and the summaries feed two more, so each would have been issued twice — a change made to speed the page up, doubling its most expensive query. React's `cache()` would deduplicate, but it keys on argument identity, and these take freshly built arrays, so it would have silently not applied. Creating each promise once in the route and passing it to every consumer makes sharing structural rather than dependent on a memoisation that happens to match. It also keeps the cross-feature composition in the route, where §2.3 allows data loading, instead of making `features/overview` import `features/projects` and `features/alerts` against §2.1. |
| 2026-08-20 | The dashboards get a **Postgres rollup table**, not Next.js caching — these were being conflated | The plan's "caching of dashboard aggregations" had been read as `use cache`; what was actually wanted, and what §17's own storage-engine entry lists as option one, is a summary table the read path queries. They are not alternatives of the same kind: the Next cache lives in one app process (so it desynchronises across replicas and re-runs the slow query on every miss), while a rollup lives in the database, is shared by everyone, and is fast on every read. A rollup also delivers something no cache does — **viewers agree on the numbers**, where before, two people loading the dashboard seconds apart each aggregated over their own `now()` and every figure could differ. Precisely: they agree below `rolled_up_to`; the raw tail above it is still per-request, so the newest minute can differ. "Every figure may differ" becomes "only the newest minute may differ" — a smaller claim than first written here, and the accurate one. |
| 2026-08-20 | The top-errors widget gets a **capped window**, not a range selector | It is the one query on the overview that cannot come from the rollup — keyed by message — so its cost is proportional to the errors it scans: `EXPLAIN` shows the index finding rows in 0.35 ms and the heap fetch costing 2,133 blocks for 2,785 rows, roughly a random page each, since errors are ~7% of events and scattered. The index is already optimal; the only lever is scanning fewer rows. A selector was proposed and rejected as more than the evidence supports: it buys the ability to *choose* a window, which nobody has asked for, and puts a second time control on a page that already has one ("why does the chart say 30 days and the errors say 15 minutes?"). `min(page range, 24h)` plus a visible period label removes the cliff in a few lines. Measured: 23.2 ms over 72 h, 12.4 ms over 24 h, 6.6 ms over 1 h — of which ~6 ms is fixed cost that no window reduces, which is also why narrowing below an hour buys nothing. |
| 2026-08-20 | Rollup-backed reads **union the summary with a raw tail**, rather than serving the summary alone | The rollup materialises only closed minutes — a number that changes under the reader is what it exists to prevent. Served alone, though, every chart would be permanently missing its newest minute, which on a logging tool is the minute someone is watching an incident through; the feature would read as broken. `rollup_state.rolled_up_to` marks where the summary is complete, and reads take `events` above it. Two further properties fall out for free: a just-ingested event is visible immediately, and `NULL` (nothing built yet) degrades to the pre-rollup behaviour, which is what makes the migration safe to deploy before the job has ever run. This is the same shape as TimescaleDB's real-time aggregates — worth knowing, since §17's deferred storage decision lists it. |
| 2026-08-20 | The rollup is refreshed by a **scheduled job**, not maintained incrementally at ingest | Incremental counters drift — a lost update, a rollback, a race — and drift has to be detected and repaired. A periodic recompute rebuilds each bucket from `events`, so error cannot accumulate: the worst case is one stale interval, self-corrected on the next run. It also keeps the ingest path free of contention on hot counter rows, which matters more as ingest volume is the thing expected to grow. Cost becomes a function of the schedule instead of the ingest rate. |
| 2026-08-20 | The rollup **excludes anything keyed by message**, and `release` may never become a rollup dimension | Merging per-minute top-N lists is approximate: a message ranked eleventh every minute can be first over the hour and appear in no bucket at all. The rollup exists so that viewers agree on the numbers, and agreed-but-wrong is worse than differing-but-right — so top messages and top errors stay on raw `events`, at 21% of measured page cost. `release` is excluded for a different reason: it is *designed* to change on every deploy, so as a rollup dimension it grows without bound. Environment cardinality was the visible risk; `release` is the one the widget inventory caught. |
| 2026-08-20 | A **widget inventory** (`reference/widgets.md`) is written before the rollup is designed, and kept as a reference doc | Designing the table from the two widgets that came up in conversation would have produced a schema that fits them and breaks on the third. Enumerating all of them first is what surfaced the `release` hazard, the dead `EnvironmentBreakdownWidget`, and two undocumented filter asymmetries on the overview. Keeping it afterwards has a separate justification: "which query feeds this number" currently requires opening three files. |
| 2026-08-20 | Stage D is reordered on measurement: environments registry first, **caching last** | Caching was written first on the reasoning that load scales with viewers. Stage C changed two inputs. The registry now has a measured share of database time behind it, while caching's benefit remains conditional on a viewer count the install does not have (~1). And in Next 16 caching stopped being a local change: `unstable_cache` is deprecated for `use cache`, which needs `cacheComponents: true` — an app-wide flag that errors on unhandled uncached data access in every route. Decisive on its own: caching first would make every later measurement read cache hits instead of queries, and a slow query under a cache looks fast until it misses. |
| 2026-08-20 | The environment registry writes on the ingest path and **its failure is swallowed** | It is the only deliberately swallowed error in ingest, against PROJECT.md §9. The trade is explicit: the registry is derived data, so a lost update costs one filter entry until the next event from that environment, while letting it throw would return 500 and lose the event itself. It is caught and logged in a named function rather than a bare `.catch()`, so the choice is visible at the call site. |
| 2026-08-20 | Integration fixtures are **enumerated, not generated** — a few hundred hand-specified rows, each with a stated purpose, and expected values written as literals | The instinct to make a fixture "cover every variation" splits into two things that pull opposite ways. Variety of *shapes* — NULLs, boundary timestamps, a message that straddles the 200-character grouping cut, counts on both sides of 9/10, an environment containing the separator the query joins on — is what finds bugs, and both bugs found on 2026-08-20 came from it. Variety as *randomness* is the opposite: with random data the expected value has to be computed, and the only way to compute it is to re-implement the query in TypeScript, so the test compares the code against a copy of itself. That is not theoretical — `build-payload.test.ts` did exactly that, and deleting a field from the production module broke no test. Volume gets its own corpus for Stage C, sharing the harness but none of the data. |
| 2026-08-20 | Integration tests insert with **direct SQL**, deliberately doing what got `scripts/seed-events.mjs` deleted | That script impersonated production traffic while bypassing the validation production traffic must pass, which made everything it produced untrustworthy. Here the point is inverted: control over the exact row shape *is* the subject under test. A `NULL` in a column the API always fills, and a timestamp 40 days old that the API rejects outright, are both required to test the read path — and neither is reachable through ingest. |
| 2026-08-20 | The text-alias `ORDER BY` bug is fixed **only** where a test can prove it — `overview.service.ts` now, `aggregations.service.ts` flagged and left alone | Same one-line slip in five places across two features, and the temptation is to fix all five while the cause is fresh. Three of them sit in a service with no tests and no way to write one under the current mocking pattern, so fixing them would mean shipping an unverified change to a second feature inside a change whose entire purpose was establishing verification — and if the "fix" were wrong, nothing would say so. The occurrences are recorded with line numbers in `reference/logging.md` and `PROGRESS.md`, which costs a follow-up but never a silent regression. |
| 2026-08-20 | Overview widget cards carry `role="group"` + `aria-label` purely so tests can address them | PROJECT.md §11 forbids querying by class or id, and the cards were unlabelled `div`s with nothing else to grab. The alternative — relaxing the rule for "components that happen to have no semantics" — would hollow it out, since any component can be described that way. Adding the accessible name is a smaller change than weakening the rule, and it is independently correct for screen readers. |
| 2026-08-20 | Tests for `features/overview/` are pulled **ahead** of the optimisation they protect | WORKFLOW.md §2 would require them alongside each change regardless. The feature has zero coverage today and is precisely what Stages D and E rewrite, so writing them inside the first optimisation would mean inventing a testing approach for a database-touching service while also changing its behaviour — the two failure modes would be indistinguishable. |
| 2026-08-19 | First staging deploy went to **DigitalOcean**, not the Hetzner recommended in `LAUNCH.md` §0.1 | The recommendation stands on price/performance and is unchanged; the account already existed on DigitalOcean and a throwaway staging box is the wrong place to spend an afternoon on provider onboarding. The measurements the run produced are provider-neutral. `LAUNCH.md` Appendix B records the DigitalOcean specifics, including two defects in its Marketplace Docker image (Docker daemon API ports 2375/2376 left open in UFW; `fail2ban` installed but never enabled). |
| 2026-08-19 | DNS for the staging host stays at the registrar; **no Cloudflare** | The staging run exists to prove ACME issuance. Putting in front of it a proxy that is known to interfere with ACME adds a failure mode that proves nothing, and moving nameservers costs hours of propagation that verify nothing either. Cloudflare goes in later as its own step (Phase 8), with a health check straight after. |
| 2026-08-19 | Certificate dry run went at the **production** Let's Encrypt CA, not staging | The `Caddyfile` has no `acme_ca` directive and no environment substitution for one, so a staging-CA rehearsal is a code change, not a config change. The failed-validation limit is per hostname per hour, so a mistake costs an hour; the weekly per-domain issuance limit is unreachable by hand. Revisit only if a run ever burns the hourly limit. |
| 2026-08-19 | SSH hardening is a `sshd_config.d/00-hardening.conf` drop-in, never a `sed` over `sshd_config` | Ubuntu's main config opens with `Include sshd_config.d/*.conf` and OpenSSH takes the **first** value it sees, so any cloud-init drop-in outranks the main file and an edit there can appear to apply while changing nothing. A `00-` prefix sorts ahead of the images' `50-`/`60-` files. `sshd -T` is the only check that reports effective config. `LAUNCH.md` Appendix A was corrected — it had recommended the `sed`. |
| 2026-08-19 | Webhook payload's `condition` no longer carries a `threshold` alias of `count` | It was undocumented, duplicated `count`, and had no consumer — `build-payload.test.ts` "covered" it only by reimplementing the assembly locally, so it tested a copy rather than the shipped code. Removed while the install was pre-launch and dropping it broke nothing; after real integrations exist it would have been a breaking change. The test file now imports the real `assembleAlertPayload`. |
| 2026-08-19 | Load generators talk to the **HTTP API**; `scripts/seed-events.mjs` deleted | It wrote rows straight into Postgres, exercising none of auth, rate limiting, validation or the attribute type registry — and it was broken anyway (hardcoded project slug `"some"`, error message saying `"test"`). Replaced by `event-one-by-key.mjs` (paced single requests, for watching the dashboard) and `events-batch-by-key.mjs` (batched, for volume), sharing `event-factory.mjs`. Credentials come from `LOGGER_API_KEY`/`LOGGER_URL`, matching `demo-live.mjs`, because the repository is public. |
| 2026-08-13 | Unit tests stay colocated with their source; **rejected** a per-feature `tests/` folder | Colocation is what makes a missing test visible in the folder listing and the diff — the mechanism WORKFLOW.md §2 leans on — and it makes `git mv` carry a test along with its module instead of orphaning it. The perceived inconsistency was only that features keep logic in different subfolders (`auth` in `actions/`, `ingest` in `services/`+`utils/`); the rule was already uniform at 32/32. Revisit only if bulk `.test.tsx` component tests start cluttering per-component folders. See `PROJECT.md` §11. |

---

## 18. How to Continue

When resuming:
1. Open `docs/PROGRESS.md` — it points to the current feature.
2. Open the feature doc in `docs/features/`.
3. Read its **Status**, **Locked decisions**, and **Implementation Checklist**.
4. Find the first unchecked item, continue from there.
5. After each work session, update the feature doc's Status block and PROGRESS.md.
6. If a global decision changes (stack, schema, RBAC concept) → also append to §17 here.
