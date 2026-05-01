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

---

## 18. How to Continue

When resuming:
1. Open `docs/PROGRESS.md` — it points to the current feature.
2. Open the feature doc in `docs/features/`.
3. Read its **Status**, **Locked decisions**, and **Implementation Checklist**.
4. Find the first unchecked item, continue from there.
5. After each work session, update the feature doc's Status block and PROGRESS.md.
6. If a global decision changes (stack, schema, RBAC concept) → also append to §17 here.
