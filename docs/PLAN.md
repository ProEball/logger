# Logger — Project Plan

> Status: **Planning phase**. Nothing implemented yet.
> Last updated: 2026-04-29

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

All planning-phase questions resolved on 2026-04-29. No open blockers for
implementation.

| # | Question | Resolution |
|---|---|---|
| Q1 | Concrete filter set on events page | See §10 |
| Q2 | Notification channel for MVP | Webhook only (incl. Slack incoming hooks). Email/SMS stubbed via same interface, deferred. See §13 |
| Q3 | Backup strategy | `pg_dump -Fc` nightly + offsite via rclone. Retention 7d + 4w. pgBackRest only if DB > 50 GB. See §15.2 |
| Q4 | Reverse proxy / TLS | Caddy in compose. Auto Let's Encrypt. See §15.1 |
| Q5 | Telemetry / health | `/api/health` + `/api/health/ready` + pino logs to stdout. Prometheus deferred. See §15.3 |

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

**MVP strategy**: `pg_dump -Fc` nightly via a dedicated `backup` container.

- **Retention**: 7 daily + 4 weekly = 11 files (~55 GB max with current size estimates).
- **Local**: write to a `backups` volume.
- **Offsite**: `rclone copy` to S3-compatible bucket (Backblaze B2 / Cloudflare R2 / MinIO).
- **Restore**: documented `pg_restore` procedure (defer doc to `docs/OPERATIONS.md`
  when implementation starts).

DB size projection: ~22 GB raw → ~5 GB compressed dump. Single dump completes
in minutes.

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

When implementation starts, build in this order. Each step is independently
testable.

1. **Foundation** — Next.js scaffold, Drizzle setup, base SCSS, Redux store skeleton.
2. **Auth + Organizations** — better-auth, sign-in, create org on first login,
   invite flow, system roles seeded.
3. **Roles management UI** — `/[org]/settings/roles`, custom role CRUD.
4. **Projects + API keys** — CRUD, per-project member overrides.
5. **Ingest endpoints** — single + batch, api-key auth, validation, write.
6. **Events list + filters + detail** — the core read flow.
7. **Dashboard** — widgets on top of events.
8. **Alerts** — rules CRUD, evaluation worker, notifications abstraction.
9. **Polish** — auto-refresh control, retention via pg_partman, error pages,
   account/sessions screens.
10. **Docker packaging** — compose, prod build, worker container.

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

---

## 18. How to Continue

When resuming:
1. Re-read §2 (Decisions) and §3 (Open Questions).
2. Pick a roadmap item from §16.
3. Drill into that feature: data flow, components, server actions, edge cases.
4. Update this doc as decisions are made (append to §17, mark items as done in §16).
