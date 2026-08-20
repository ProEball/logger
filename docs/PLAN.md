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
unit-tested (50 tests); `e2e/overview.spec.ts` (17 tests) asserting the rendered
page; and `overview.service.ts` covered by 38 integration tests against a real
Postgres on a purpose-built `logger_itest` database (`npm run test:it`).

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

   **Still open: the per-project environment pills**, `STRING_AGG(DISTINCT
   environment)` inside `getProjectSummaries` — 18.1% before, **23.8% after**,
   now the second most expensive query on the page. A registry cannot answer it
   as written, because those pills are scoped to the *selected range* while the
   filter list is not. Closing it means deciding what the pills mean — "the
   environments this project uses" or "the ones that appeared in this window" —
   and that is a product question, deferred on 2026-08-20 rather than settled
   inside an optimisation.
2. **A rollup table for the dashboards.** *First increment shipped 2026-08-20 —
   `event_rollup_minutes` + `rollup_state` + the `event-rollup` job, with the
   volume chart and level breakdown reading it. `getProjectSummaries` and
   everything keyed by message still read `events`; that is increment two.
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

5. **Caching of dashboard aggregations**, of which there is currently none. The
   app is fully dynamically rendered (§17, CSP nonce), so every viewer
   recomputes every aggregation on every load — load grows linearly with the
   number of people looking at a dashboard, before a single extra event is
   ingested. The events list stays uncached; staleness is acceptable on a chart
   and not on a log tail. Last, for the three reasons in the note above.

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

---

## 17. Decision Log

| Date | Decision | Rationale |
|---|---|---|
| 2026-04-29 | Postgres over ClickHouse | 1M/day fits Postgres; CH adds ops cost without payoff at this scale |
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
