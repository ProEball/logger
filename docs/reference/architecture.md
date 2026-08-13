# Architecture

## Folder structure (Feature-Driven Development)

```
app/            Next.js App Router ONLY — layouts, pages, route handlers. No business logic here.
core/           App-wide, cross-cutting concerns (see below)
features/       One folder per feature, self-contained
shared/         Reusable library code used across features
db/             Postgres Docker build context (not application code)
docs/           Planning docs, design docs, and (now) this reference
e2e/            Playwright end-to-end specs
scripts/        One-off/operational scripts (demo seeding, migration apply)
```

**Rule enforced by project convention** (`.claude/rules/PROJECT.md`): features must never import from another feature; anything needed by more than one feature must move to `shared/`. All imports use the `@/` alias mapped to the repo root (`@/core/...`, `@/shared/...`, `@/features/...`).

### `core/` — app-wide services

| Subfolder | Responsibility |
|---|---|
| `core/auth/` | better-auth server config (`config.ts`) and session helpers (`server.ts`: `getSession()`, `getCurrentUser()`) |
| `core/db/` | Drizzle schema (`schema/`), migrations (`migrations/`), Postgres client singleton + slow-query-logging middleware (`middleware/`) |
| `core/env/` | Validated environment variables (`@t3-oss/env-nextjs` + Zod) |
| `core/i18n/` | Typed dictionary lookup (`t(key)`), English-only today, falls back to returning the key itself rather than throwing if a key is missing |
| `core/logger.ts` | App-wide pino logger — see [misc.md](misc.md#app-logger) for an important dead-code note (two other logger files exist and are unused) |
| `core/store/` | Redux Toolkit store: `theme`, `org`, `project`, `user` slices, plus client-side hydrator components that seed Redux from server-fetched data |
| `core/theme/` | Theme resolution (`dark`/`light`/`system`), cookie persistence, no-flash inline script, `ThemeProvider` |
| `core/worker/` | pg-boss process bootstrap — see [Background jobs](#background-jobs) below |

### `features/` — one folder per feature

Each feature follows: `actions/` (Server Actions), `components/` (per-component subfolders), `services/` (data access / business logic), `utils/` (pure functions), and where relevant `jobs/` (pg-boss job definitions) and `hooks/`.

| Feature | Responsibility |
|---|---|
| `alerts` | Alert rule CRUD, evaluation, webhook delivery |
| `api-keys` | API key generation/hashing/storage/revocation/rate-limit config |
| `auth` | Login, logout, setup wizard (first-run bootstrap), password reset, account/session management |
| `dashboard` | Per-project metrics aggregation (time-bucketed charts, breakdowns) |
| `events` | Events list/detail UI, filtering, keyset-paginated query service |
| `ingest` | The event-ingestion pipeline: API-key auth, validation, attribute-type enforcement, enrichment, insert; also owns the partition-maintenance job |
| `organizations` | Organization CRUD, membership, invitations |
| `overview` | Org-level (cross-project) rollup dashboard |
| `projects` | Project CRUD with soft delete and per-org unique slugs |
| `roles` | RBAC role CRUD, permission-matrix UI, system-role seeding |

### `shared/` — cross-feature library

- `shared/components/` — the UI kit (Button, Table, Modal, Drawer, Combobox, CommandPalette, JsonTree, KeyValue, LevelBadge, LogRow, Timeline, Toast, Tooltip, Sidebar, Topbar, etc.). Its top-level `index.ts` barrel is the **only** allowed barrel file in the project (per-component barrels elsewhere are disallowed by convention).
- `shared/permissions/` — the RBAC engine: `registry.ts` (permission string catalogue), `groups.ts` (UI grouping), `check.ts` (`hasPermission`), `guards.ts` (`assertPermission`, `assertOwner`), `hooks.ts` (`usePermission` client hook). See [users-roles.md](users-roles.md).
- `shared/hooks/`, `shared/types/`, `shared/utils/` — generic reusable code. (`shared/services/` is defined by the FDD convention in `.claude/rules/PROJECT.md` but does not currently exist — its only occupant was a dead logger module, removed 2026-08-13.)
  - `shared/hooks/use-is-hydrated.ts` — `useSyncExternalStore`-based replacement for the `useState(false)` + `useEffect(setMounted(true))` mount-gate idiom. Same two-phase behaviour, but React drives it through the store rather than a cascading render from an effect body (which `react-hooks/set-state-in-effect` flags as an error). Used by `Modal` (portal target absent during SSR) and by `EventsPage`/`AutoRefreshControl` (Redux preference lands only after `OrgHydrator`'s mount effect, so the hydrating render must match SSR).

### `app/` — routing only

Route segments (App Router conventions: `page.tsx`, `layout.tsx`, `loading.tsx`, `error.tsx`, `not-found.tsx`, `route.ts`):

```
/                                    home
/login, /forgot-password             public auth pages
/reset-password/[token]              password reset
/invite/[token]                      invitation acceptance
/setup                               first-run bootstrap wizard (404s after first user exists)
/account, /account/sessions          account settings, active sessions

/api/auth/[...all]                   better-auth catch-all handler
/api/health, /api/health/ready       liveness / readiness
/api/ingest, /api/ingest/batch       event ingestion (API-key auth)
/api/version                         build metadata

/[org]                               org overview   (route group "(org-shell)")
/[org]/projects, /projects/new       project list / create
/[org]/team                          member list
/[org]/settings                      org settings
/[org]/settings/danger               org deletion
/[org]/settings/roles(/new|/[id])    role management (owner-only)

/[org]/[project]                     project dashboard
/[org]/[project]/events              events list (detail is a `?event=<id>` drawer, not a route)
/[org]/[project]/alerts(/new|/[id])  alert rules
/[org]/[project]/settings            project settings
/[org]/[project]/settings/api-keys   API key management
/[org]/[project]/settings/danger     project deletion
```

`app/[org]/[project]/**` is a sibling of the `(org-shell)` route group, not nested under it. `app/_demo` is a dev-only route excluded from routing by the underscore prefix.

**Access control is layered:**
1. `proxy.ts` (repo root — Next.js 16 renamed `middleware.ts` to `proxy.ts`; see `AGENTS.md`'s warning about this kind of breaking rename) does coarse gating: redirect to `/setup` if no users exist yet, redirect to `/login` if unauthenticated, for all paths except a small public allowlist (`/login`, `/forgot-password`, `/reset-password/*`, `/invite/*`). It does **not** check permissions or org membership, and its matcher excludes `api/*` entirely — API routes handle their own auth. It also mints the per-request CSP nonce and attaches the policy to every response it produces — routing decisions live in `resolveRoute()`, with the exported `proxy()` wrapping them to apply the header (see [security.md](security.md#content-security-policy-nonce-based)).
   - The "does an owner exist yet" check (`checkSetupDone()`) is cached in a module-level variable for **5 seconds** (`CACHE_TTL_MS`) to avoid a `COUNT(*) FROM users` on every single request — deliberately caches only the `true` result (a false negative would wrongly bounce a freshly-onboarded owner back to `/setup`). This cache is disabled (`CACHE_TTL_MS = 0`) when `process.env.E2E_MODE === "true"`, since e2e tests reset the database between spec files within one long-lived server process, and a stale cached `true` would misroute the next file's setup flow (see [misc.md#testing](misc.md#testing)).
2. Every Server Component page and Server Action does its own fine-grained permission check via `getMembership()` + `hasPermission()`/`assertPermission()`/`assertOwner()` — see [users-roles.md](users-roles.md#access-control-enforcement).

## Server Actions pattern

All 31 `features/**/actions/*.action.ts` files follow one convention:

```ts
"use server";
const schema = z.object({ /* ... */ });

export async function xxxAction(data: Input): Promise<{ ...success } | { error: string }> {
    const parsed = schema.safeParse(data);
    if (!parsed.success) return { error: "Invalid input." };

    const user = await getCurrentUser();
    if (!user) return { error: "Not authenticated." };

    const org = await getOrgBySlug(slug);
    if (!org) return { error: "Organization not found." };

    const membership = await getMembership(user.id, org.id);
    try {
        assertPermission(membership, "resource.action");   // or assertOwner(membership)
    } catch {
        return { error: "You don't have permission to ..." };
    }

    // mutate via a service function
    revalidatePath(...);
    return { ...success };
}
```

Key convention: **actions never throw to the caller** — every failure path (validation, auth, permission, DB constraint violation) is converted to a typed `{ error: string }` return value. `ForbiddenError` thrown by `assertPermission`/`assertOwner` is always caught locally, not propagated.

## Database schema

Schema source: `core/db/schema/*.ts` (Drizzle), barrel-exported from `core/db/schema/index.ts`. Migrations: `core/db/migrations/0000`–`0006` (7 migrations as of 2026-08-12), applied via `drizzle-kit migrate`.

### Auth tables (better-auth managed, plural table names)

| Table | Key columns | Notes |
|---|---|---|
| `users` | `id` (text, PK), `name`, `email` (unique), `emailVerified` (bool), `image`, `preferences` (jsonb, default `{theme:"dark"}`), `createdAt`, `updatedAt` | IDs are `text`, not `uuid` — generated by better-auth |
| `sessions` | `id` (text, PK), `userId` → `users.id` CASCADE, `token` (unique), `expiresAt`, `ipAddress`, `userAgent` | |
| `accounts` | `id`, `userId` CASCADE, `accountId`, `providerId`, `accessToken`/`refreshToken`/`idToken` (nullable), `scope`, `password` (nullable — hashed credential password lives **here**, not on `users`) | OAuth-related columns exist but are unused (only `emailAndPassword` auth is enabled) |
| `verifications` (JS) / `verification_tokens` (SQL table name) | `id`, `identifier`, `value`, `expiresAt` | Password-reset / email-verification tokens |

### Organization / membership tables

| Table | Key columns | Notes |
|---|---|---|
| `organizations` | `id` (uuid PK), `name`, `slug` (unique), `plan` (default `"internal"`), `limits` (jsonb, default `{}`), `allowSignup` (bool, default `false`), timestamps | |
| `roles` | `id` (uuid PK), `organizationId` → `organizations.id` CASCADE, `name`, `description`, `permissions` (`text[]`, default `[]`), `isSystem` (bool), `isDefault` (bool), timestamps | Unique on `(organizationId, name)` |
| `organizationMembers` | PK `(organizationId, userId)`, `roleId` → `roles.id` **RESTRICT**, `isOwner` (bool, default `false`), `joinedAt` | Index on `userId`. Ownership is a boolean flag, **not** a role |
| `projectMemberRoles` | PK `(projectId, userId)`, `roleId` → `roles.id` RESTRICT | Placeholder for future per-project role overrides — unused today (MVP is org-level roles only) |
| `invitations` | `id` (uuid PK), `organizationId` CASCADE, `email`, `roleId` RESTRICT, `token` (unique), `expiresAt`, `invitedBy` → `users.id` SET NULL, `acceptedAt` (null = pending) | Partial index on `(email, organizationId) WHERE accepted_at IS NULL` |

### Project / API key tables

| Table | Key columns | Notes |
|---|---|---|
| `projects` | `id` (uuid PK), `organizationId` CASCADE, `name`, `slug`, `retentionDays` (default `30`, not currently enforced dynamically — see [logging.md](logging.md)), `deletedAt` (soft delete) | Partial **unique** index `(organizationId, slug) WHERE deletedAt IS NULL` — slugs are reusable after soft-delete; partial index on `(organizationId) WHERE deletedAt IS NULL` |
| `apiKeys` (`api_keys`) | `id` (uuid PK), `projectId` CASCADE, `name`, `keyHash` (unique), `keyPrefix`, `rateLimitPerMin` (default `1000`), `lastUsedAt`, `revokedAt`, `createdBy` → `users.id` SET NULL | Partial index `(projectId) WHERE revokedAt IS NULL` |

### Events (partitioned)

See [logging.md](logging.md#the-events-table) for the full column list and [Events partitioning](#events-partitioning) below for the partitioning mechanics. Events reference `projects.id` with **`ON DELETE RESTRICT`** — a project cannot be hard-deleted while it still has events (soft delete via `deletedAt` is the only delete path in the UI; events naturally age out via partition retention).

### Alerts

| Table | Key columns | Notes |
|---|---|---|
| `alertRules` (`alert_rules`) | `id`, `projectId` CASCADE, `name`, `description`, `filter` (jsonb — same shape as the events-list filters), `condition` (jsonb — `{type:"threshold", count, windowMinutes}`), `channels` (jsonb — webhook configs), `state` (`"ok"｜"firing"`), `stateChangedAt`, `lastEvaluatedAt`, `lastMatchCount`, `enabled` (bool), `notifyOnResolve` (bool, default `true`), `createdBy` → `users.id` SET NULL, `version` (int, default `1`, optimistic concurrency) | Partial index `(projectId) WHERE enabled = true` |
| `alertNotifications` (`alert_notifications`) | `id`, `alertRuleId` CASCADE, `triggeredAt`, `state`, `payload` (jsonb), `channelType`, `channelTarget`, `deliveryStatus` (`pending｜delivered｜failed｜retrying`), `deliveryAttempts`, `deliveryLastError`, `deliveryHttpStatus`, `deliveredAt` | Index `(alertRuleId, triggeredAt)` |

### Attribute type registry

| Table | Key columns | Notes |
|---|---|---|
| `attributeKeyTypes` (`attribute_key_types`) | PK `(projectId, key)`, `type` (text: `"string"｜"number"｜"boolean"`, app-enforced only — no DB check constraint), `createdAt` | Records the **first-seen** JSON type per `(project, attribute key)`, used to reject subsequent type-mismatched values at ingest — see [logging.md](logging.md#attribute-type-enforcement) |

### Migrations

| # | Notable content |
|---|---|
| 0000 | Baseline: auth tables, `organizations`, `roles`, `organizationMembers`, `projectMemberRoles`, `invitations` |
| 0001 | `apiKeys`, `projects` |
| 0002 | `ALTER TABLE api_keys ALTER COLUMN created_by SET DATA TYPE text` |
| 0003 | **Hand-written raw SQL** — creates the partitioned `events` table, FK, indexes (including GIN indexes not modeled in Drizzle), and configures `pg_partman` |
| 0004 | `alertRules`, `alertNotifications` |
| 0005 | Adds `apiKeys.rateLimitPerMin` |
| 0006 | Adds `attributeKeyTypes` (most recent, 2026-08-12) |

## Events partitioning

`events` is a native Postgres **partitioned table** (`PARTITION BY RANGE (timestamp)`), which Drizzle's schema DSL cannot express — the Drizzle file in `core/db/schema/events.ts` exists only for type-safe query building; the real DDL lives in raw SQL migration `0003_giant_thena.sql`.

- Partition management via **`pg_partman`** (`public.create_parent(p_control := 'timestamp', p_interval := '1 day', p_premake := 7)`), premaking 7 days of future partitions.
- **Retention: 30 days** (`retention = '30 days'`, `retention_keep_table = false`, `retention_keep_index = false`, `infinite_time_partitions = true`) — old partitions are dropped entirely, not just detached.
- **Primary key**: composite `(project_id, timestamp, id)` — required because a partitioned table's PK must include the partition key.
- Indexes: `(project_id, timestamp)`, `(project_id, level, timestamp)`, `(project_id, error_type, timestamp) WHERE error_type IS NOT NULL`, plus two indexes that exist **only in raw SQL** (not modeled in the Drizzle schema file): `GIN` on `attributes` and `GIN` on `to_tsvector('simple', message)` for full-text search.
- Maintenance runs hourly via a pg-boss cron job (`SELECT public.run_maintenance(p_analyze := false)`) — see below.

## Background jobs

`core/worker/worker.ts` owns a module-level `pg-boss` singleton (`getBoss()`/`startWorker()`). It is started either:
- **In-process**, inside the Next.js server, when `WORKER_IN_PROCESS=true` — wired via `instrumentation.ts`'s Next.js `register()` hook (only runs when `NEXT_RUNTIME === "nodejs"`); convenient for dev/single-instance deployments.
- As a **separate worker container** in production (planned architecture per `docs/features/08-docker-packaging.md`, not yet built as an actual Dockerfile — see [misc.md](misc.md#deployment)).

Three jobs are registered (`registerXJob(boss)` calls, in this order):

| Job | Trigger | What it does |
|---|---|---|
| `partman-maintenance` | Cron `0 * * * *` (hourly), `singletonKey` guards against duplicate execution across replicas | `SELECT public.run_maintenance(p_analyze := false)` — advances/prunes `events` partitions. Failure is logged at `ERROR` and swallowed (not rethrown) |
| `alert-evaluation` | Cron `* * * * *` (every minute), `singletonKey` | Calls `evaluateAllEnabled(boss)` — evaluates every enabled alert rule, updates state, enqueues `alert-delivery` jobs for state transitions |
| `alert-delivery` | On-demand (`boss.work`, no cron — enqueued by the evaluator) | Delivers one webhook notification, `retryLimit: 3, retryDelay: 30, retryBackoff: true` |

Because `singletonKey` alone isn't bulletproof under a rolling deploy with `WORKER_IN_PROCESS=true` on every app replica, the planned production topology pins the dedicated worker container to `replicas: 1` as a second safeguard (per `docs/PLAN.md`) — not yet expressed in any compose file today.

## Query performance / observability

`core/db/middleware/slow-query-logger.ts` wraps the raw `postgres.js` client in a `Proxy` that times every query and logs (`logger.warn({ sql, duration_ms, params_count }, "slow query")`) any query taking **≥ 500ms**. Wired in once, in `core/db/client.ts`, ahead of the Drizzle instance — every query issued through `db`, anywhere in the app, is covered. The Postgres client itself is a `global`-cached singleton outside production to avoid connection-pool exhaustion across Next.js hot-reloads (`postgres(url, { max: 10, idle_timeout: 20, connect_timeout: 10 })`).
