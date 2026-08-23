# Architecture

## Folder structure (Feature-Driven Development)

```
app/            Next.js App Router ONLY — layouts, pages, route handlers. No business logic here.
core/           App-wide, cross-cutting concerns (see below)
features/       One folder per feature, self-contained
shared/         Reusable library code used across features
db/             Postgres + backup Docker build contexts (not application code)
docs/           Planning docs, design docs, OPERATIONS.md, and (now) this reference
e2e/            Playwright end-to-end specs
itest/          Support code for the integration suite (`*.itest.ts` files live
                beside their sources; only the harness lives here)
bench/          Benchmark support + committed baselines (`*.bench.ts` likewise
                live beside their sources)
scripts/        Build and operational scripts (worker bundling, backup/restore, ingest load generators)
.github/        CI and release workflows
```

Deployment artifacts sit at the repo root: `Dockerfile`, `.dockerignore`, `docker-compose.yml` (production), `docker-compose.dev.yml` (Postgres only), `Caddyfile`, `.env.production.example`. See [misc.md#deployment](misc.md#deployment).

`docs/reference/` is also **runtime data**, not just documentation: the in-app help centre reads those nine markdown files off disk. `next.config.ts` declares them via `outputFileTracingIncludes` and `.dockerignore` exempts the directory from its `docs` exclusion — remove either and every help page 500s in production while working in dev.

**Rule enforced by project convention** (`.claude/rules/PROJECT.md`): features must never import from another feature; anything needed by more than one feature must move to `shared/`. All imports use the `@/` alias mapped to the repo root (`@/core/...`, `@/shared/...`, `@/features/...`).

### `core/` — app-wide services

| Subfolder | Responsibility |
|---|---|
| `core/auth/` | better-auth server config (`config.ts`) and session helpers (`server.ts`: `getSession()`, `getCurrentUser()`) |
| `core/db/` | Drizzle schema (`schema/`), migrations (`migrations/`), Postgres client singleton + slow-query-logging middleware (`middleware/`), the migration-status check used by `/api/health/ready` (`migration-status.ts`), and the standalone migration runner entrypoint (`migrate.ts`) |
| `core/env/` | Validated environment variables (`@t3-oss/env-nextjs` + Zod) |
| `core/i18n/` | Typed dictionary lookup (`t(key)`), English-only today, falls back to returning the key itself rather than throwing if a key is missing |
| `core/logger.ts` | App-wide pino logger — see [misc.md](misc.md#app-logger) for an important dead-code note (two other logger files exist and are unused) |
| `core/store/` | Redux Toolkit store: `theme`, `org`, `project`, `user` slices, plus client-side hydrator components that seed Redux from server-fetched data |
| `core/theme/` | Theme resolution (`dark`/`light`/`system`), cookie persistence, no-flash inline script, `ThemeProvider` |
| `core/worker/` | pg-boss bootstrap (`worker.ts`), the standalone worker container's entrypoint (`main.ts`), its liveness file-touch (`health-touch.ts`) and signal handling (`shutdown.ts`) — see [Background jobs](#background-jobs) below |

### `features/` — one folder per feature

Each feature follows: `actions/` (Server Actions), `components/` (per-component subfolders), `services/` (data access / business logic), `utils/` (pure functions), and where relevant `jobs/` (pg-boss job definitions) and `hooks/`.

| Feature | Responsibility |
|---|---|
| `alerts` | Alert rule CRUD, evaluation, webhook delivery |
| `api-keys` | API key generation/hashing/storage/revocation/rate-limit config |
| `auth` | Login, logout, setup wizard (first-run bootstrap), password reset, account/session management |
| `dashboard` | Per-project metrics aggregation (time-bucketed charts, breakdowns) |
| `events` | Events list/detail UI, filtering, keyset-paginated query service |
| `ingest` | The event-ingestion pipeline: API-key auth, validation, attribute-type enforcement, enrichment, insert. Also owns the derived read-path tables written from that path — the environment registry and the event rollup — and the two maintenance jobs behind them (`partman-maintenance`, `event-rollup`) |
| `organizations` | Organization CRUD, membership, invitations |
| `overview` | Org-level (cross-project) rollup dashboard. Its search-param parsing, chart bucket widths and per-project row assembly live in `overview/utils/` — they were in `app/[org]/(org-shell)/page.tsx` until 2026-08-20, which put business logic in a route (against `PROJECT.md` §2.3) and left it untestable. The route still performs the data-loading fan-out, which §2.3 permits — and since 2026-08-20 it passes each query down as an **unawaited promise** so the page streams section by section. Keeping the fan-out in the route is deliberate: it composes `projects` and `alerts`, and moving that into the feature would make one feature import two others, against §2.1. Since 2026-08-20 the fan-out targets `overview-cache.service.ts` rather than `overview.service.ts` — see [Read caching](#read-caching). |
| `projects` | Project CRUD with soft delete and per-org unique slugs |
| `roles` | RBAC role CRUD, permission-matrix UI, system-role seeding |

### `shared/` — cross-feature library

- `shared/components/` — the UI kit (Button, Table, Modal, Drawer, Combobox, CommandPalette, JsonTree, KeyValue, LevelBadge, LogRow, Timeline, Toast, Tooltip, Sidebar, Topbar, etc.). Its top-level `index.ts` barrel is the **only** allowed barrel file in the project (per-component barrels elsewhere are disallowed by convention).
- `shared/permissions/` — the RBAC engine: `registry.ts` (permission string catalogue), `groups.ts` (UI grouping), `check.ts` (`hasPermission`), `guards.ts` (`assertPermission`, `assertOwner`), `hooks.ts` (`usePermission` client hook). See [users-roles.md](users-roles.md).
- `shared/hooks/`, `shared/types/`, `shared/utils/`, `shared/services/` — generic reusable code.
  - `shared/services/rollup-boundary.service.ts` — the watermark up to which the event rollup is complete. **This is what revived `shared/services/`**, which had been empty since its only occupant, a dead logger module, was removed on 2026-08-13. Both the org overview and the project dashboard read the rollup and both need the boundary; a second copy of it was the alternative, and §2.1 says what to do instead. It returns `null` — meaning "read raw `events`" — for any doubt at all, including the case a project has no `rollup_state` row: `MIN` and the NULL filter both ignore absent rows, so such a project would otherwise inherit another's boundary and then contribute no summary rows below it, undercounting silently.
  - `shared/utils/query-cache-key.ts` — the cache key for a cached read, shared by both pages. See [security.md](security.md#cached-reads-and-the-scope-in-the-cache-key): the key is an authorization boundary, and a second copy of one is the last thing this tree needs.
  - `shared/utils/read-cache-settings.ts` — the 30-second TTL and 5-minute staleness ceiling both read caches use, and the `E2E_MODE` collapse. It lived in `features/overview` until 2026-08-21, which forced `features/dashboard` to import across the feature boundary to reuse it.
  - `shared/utils/ttl-cache.ts` — a bounded in-process cache with **single-flight** recomputation, **stale-while-revalidate**, and a hard staleness ceiling. Added 2026-08-20 for the overview's read path (see [Read caching](#read-caching)). All three properties exist for a named failure: without single flight a cache makes a stampede worse rather than better, since every reader misses at the same instant; without serving stale, one reader per TTL pays the full recomputation; without the ceiling, a database that has been down for an hour is indistinguishable from one that is up. The clock is injectable so tests do not sleep.
  - `shared/hooks/use-auto-refresh.ts` and `shared/components/AutoRefreshControl/` — the interval-reload control, moved out of `features/events/` on 2026-08-20. It had three consumers by then (the events list, the project dashboard, the org overview), and the first two reached it by importing across features, which §2.1 forbids. Its i18n keys moved from the `events` namespace to `common` for the same reason: a shared component reading a feature's dictionary is the same violation in another medium.

    Note what the move did **not** remove: the control still imports `updatePreferencesAction` from `features/auth`, so a `features → features` arrow became a `shared → features` one. `shared/components/AppShell/parts/ThemeSwitcher.tsx` already does the same, so this is the established shape rather than a new exception — but no rule in `PROJECT.md` sanctions it, and a shared component that reaches into a feature is a dependency edge pointing the wrong way. Fixing it properly means the preferences action moving somewhere both can see; recorded here rather than done, because it touches the theme switcher too.
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

Schema source: `core/db/schema/*.ts` (Drizzle), barrel-exported from `core/db/schema/index.ts`. Migrations: `core/db/migrations/0000`–`0010` (11 migrations as of 2026-08-23), applied via `drizzle-kit migrate`.

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
| `eventRollupMinutes` (`event_rollup_minutes`) | PK `(project_id, minute)`, `total` (int), `by_level` / `by_env` (jsonb), `errors` (int, **`GENERATED ALWAYS AS` `error` + `fatal` from `by_level`, STORED**), `computed_at` | Added 2026-08-20 (migration 0008). Per-minute event counts, rebuilt from `events` by the `event-rollup` job — see [logging.md](logging.md#the-rollup). **One row per `(project, minute)`, not per `(project, minute, level, environment)`**: the finer key multiplies rows by dimensions the client controls, and `environment` is unvalidated free text at ingest. Keeping breakdowns inside the row degrades a runaway dimension into a fatter row instead of a row explosion, and the environment keys are capped at 20 with the tail folded into `(other)`. **`by_level` and `by_env` are marginals, not a joint distribution** — a read filtering by level *and* environment at once falls back to `events`. Only minutes that had events get a row |
| `rollupState` (`rollup_state`) | PK `project_id`, `refresh_from`, `rolled_up_to` (nullable) | Added 2026-08-20. `refresh_from` is the watermark the next rebuild starts at, pulled back at ingest by the batch's **oldest** timestamp — `events` records when an event happened, not when it arrived, so nothing in that table can reveal a late arrival. `rolled_up_to` is the exclusive bound the rollup is complete to, `NULL` until the first run; reads take the rollup below it and raw `events` above, which is what keeps a just-ingested event visible immediately |
| `projectEnvironments` (`project_environments`) | `projectId` → `projects.id` CASCADE, `environment` (text, **nullable**), `firstSeenAt`, `lastSeenAt`; `UNIQUE NULLS NOT DISTINCT (project_id, environment)`; index on `(project_id, last_seen_at)` | Added 2026-08-20 (migration 0007). Which environments a project has sent events from, maintained at ingest, so the overview's filter bar does not scan `events` — see [logging.md](logging.md#environment-registry). **No primary key**: `environment` is nullable, because an absent environment is itself one of the offered options ("(unset)"), and a nullable column cannot be part of a PK. `NULLS NOT DISTINCT` is what stops Postgres treating every NULL as unique and accumulating one row per ingest request |

### Migrations

| # | Notable content |
|---|---|
| 0000 | Baseline: auth tables, `organizations`, `roles`, `organizationMembers`, `projectMemberRoles`, `invitations` |
| 0001 | `apiKeys`, `projects` |
| 0002 | `ALTER TABLE api_keys ALTER COLUMN created_by SET DATA TYPE text` |
| 0003 | **Hand-written raw SQL** — creates the partitioned `events` table, FK, indexes (including GIN indexes not modeled in Drizzle), and configures `pg_partman` |
| 0004 | `alertRules`, `alertNotifications` |
| 0005 | Adds `apiKeys.rateLimitPerMin` |
| 0006 | Adds `attributeKeyTypes` (2026-08-12) |
| 0007 | Adds `projectEnvironments` (2026-08-20). **Generated, then hand-extended** with a backfill: `INSERT … SELECT project_id, environment, MIN(timestamp), MAX(timestamp) FROM events GROUP BY …`. Without it an existing install loses its environment filter until fresh events arrive from every environment it had, since the registry is written at ingest and knows no history. That statement reads every row of `events` once and will dominate the migration's runtime on a large table |
| 0008 | Adds `eventRollupMinutes` and `rollupState` (most recent, 2026-08-20). **Generated, then hand-extended** to seed `rollup_state.refresh_from` from each project's oldest event. The rollup itself is deliberately *not* built here: a migration that aggregates the whole events table would make deployment time proportional to data volume, and a failure mid-way would block the release instead of retrying on its own. `rolled_up_to` stays NULL, which readers treat as "nothing rolled up yet" and answer entirely from `events` — that is what makes this safe to deploy before the first job run |

### Template rollup tables (added 2026-08-23, migrations 0009–0010)

| Table | Key columns | Notes |
|---|---|---|
| `message_templates` | PK `(project_id, template_hash)` | Display text per template, plus `normalizer_version`. Never pruned — a vocabulary, not a measurement. |
| `event_template_rollup` | PK `(project_id, minute, template_hash)`, index `(project_id, template_hash, minute)` | Per-minute counts per template, with `by_level` and `latest_at`. Pruned at 30 days with the level rollup. |
| `events.template_hash` | `bigint`, nullable | Fingerprint computed at ingest. Permanently nullable: pre-2026-08-23 rows have none and no SQL can derive one, since the normaliser is TypeScript. |
| `rollup_state.templates_rolled_up_from` / `_to` | — | The **interval** the template rollup covers. Two columns, not one: see below. |

Both tables cascade on `projects.id` delete, like every other per-project table.

**Why coverage needs two columns.** `event_rollup_minutes` can summarise any
event, so its coverage is a prefix and `rolled_up_to` describes it completely.
The template rollup can only summarise events carrying a fingerprint, so it has
a floor as well as a ceiling. A reader holding only the ceiling would take a
7-day range, see it ends below the watermark, read the rollup for all of it and
silently miss every pre-deploy event — on a "top messages" widget,
indistinguishable from a message nobody sent. `templates_rolled_up_from` moves
backwards only, so a catch-up run rebuilding an older window widens the interval
instead of claiming a prefix it never had.

The index on `(project_id, template_hash, minute)` covers one template's history
— the direction the primary key does not lead on.

## Events partitioning

`events` is a native Postgres **partitioned table** (`PARTITION BY RANGE (timestamp)`), which Drizzle's schema DSL cannot express — the Drizzle file in `core/db/schema/events.ts` exists only for type-safe query building; the real DDL lives in raw SQL migration `0003_giant_thena.sql`.

- Partition management via **`pg_partman`** (`public.create_parent(p_control := 'timestamp', p_interval := '1 day', p_premake := 7)`), premaking 7 days of future partitions.
- **Retention: 30 days** (`retention = '30 days'`, `retention_keep_table = false`, `retention_keep_index = false`, `infinite_time_partitions = true`) — old partitions are dropped entirely, not just detached.
- **Primary key**: composite `(project_id, timestamp, id)` — required because a partitioned table's PK must include the partition key.
- Indexes: `(project_id, timestamp)`, `(project_id, level, timestamp)`, `(project_id, error_type, timestamp) WHERE error_type IS NOT NULL`, plus two indexes that exist **only in raw SQL** (not modeled in the Drizzle schema file): `GIN` on `attributes` and `GIN` on `to_tsvector('simple', message)` for full-text search.
- Maintenance runs hourly via a pg-boss cron job (`SELECT public.run_maintenance(p_analyze := false)`) — see below.

## Background jobs

`core/worker/worker.ts` owns a module-level `pg-boss` singleton (`getBoss()` / `startWorker()` / `stopWorker()`). It is started either:
- **In-process**, inside the Next.js server, when `WORKER_IN_PROCESS=true` — wired via `instrumentation.ts`'s Next.js `register()` hook (only runs when `NEXT_RUNTIME === "nodejs"`). A dev convenience.
- As a **separate worker container** in production: `core/worker/main.ts`, bundled to `dist/worker.js` and run as `node worker.js`. See [misc.md](misc.md#deployment).

Both paths call the same `startWorker()`, so a job registered once is picked up by both. That is the point of the split — `main.ts` adds only process concerns (health-touch, signal handling), never job registration.

Three jobs are registered (`registerXJob(boss)` calls, in this order):

| Job | Trigger | What it does |
|---|---|---|
| `partman-maintenance` | Cron `0 * * * *` (hourly), `singletonKey` guards against duplicate execution across replicas | `SELECT public.run_maintenance(p_analyze := false)` — advances/prunes `events` partitions. Failure is logged at `ERROR` and swallowed (not rethrown) |
| `event-rollup` | Cron `* * * * *` (every minute — pg-boss cron has no finer granularity), `singletonKey` so a run that overruns its minute is not doubled up | `runRollupCycle()` in `features/ingest/services/event-rollup.service.ts`: rebuilds `event_rollup_minutes` for every project whose watermark is behind, then prunes rows past retention. Catch-up is capped at **one day per run**, so the first run after migration 0008 — which starts at the oldest event — cannot aggregate the whole table in one job. Rebuild is delete-then-insert per window, not upsert, so a minute whose events have aged out loses its row instead of keeping a stale count. Failure is logged at `ERROR` and swallowed; the effect is increasingly stale dashboards, not a failed request |
| `alert-evaluation` | Cron `* * * * *` (every minute), `singletonKey` | Calls `evaluateAllEnabled(boss)` — evaluates every enabled alert rule, updates state, enqueues `alert-delivery` jobs for state transitions |
| `alert-delivery` | On-demand (`boss.work`, no cron — enqueued by the evaluator) | Delivers one webhook notification, `retryLimit: 3, retryDelay: 30, retryBackoff: true` |

**Every registrar calls `boss.createQueue(name)` before `schedule()`/`work()`.** pg-boss 12 dropped implicit queue creation; without it both calls violate the foreign key from `pgboss.schedule` to `pgboss.queue` and the worker crashes on startup. `createQueue` is `INSERT … ON CONFLICT DO NOTHING`, so it runs unconditionally on every start.

> **Fixed 2026-08-13.** This was missing, and could only ever fail against a database whose `pgboss.queue` rows did not already exist — i.e. never in a long-lived dev database, and always on a fresh production one. The worker crash-looped on first boot of the new Docker stack; `core/worker/worker.test.ts` now pins both the creation and its ordering relative to `work`/`schedule`.

**Graceful shutdown.** `main.ts` installs SIGTERM/SIGINT handlers (`core/worker/shutdown.ts`) that drain in-flight jobs via `stopWorker()` and exit. The drain is capped at 20s, deliberately under the 30s `stop_grace_period` in compose — past that, Docker SIGKILLs mid-drain. A second signal arriving during the drain is logged and ignored; a drain that throws exits non-zero rather than hanging.

**Liveness.** `core/worker/health-touch.ts` advances the mtime of `/tmp/worker-alive` every 30s from inside the worker process, which the container healthcheck probes. It lives in the process, not a wrapper script, precisely so a dead process cannot keep reporting healthy.

Because `singletonKey` alone isn't bulletproof under a rolling deploy, the `worker` service is pinned to `deploy.replicas: 1` in `docker-compose.yml` as a second safeguard.

## Query performance / observability

`core/db/middleware/slow-query-logger.ts` wraps the raw `postgres.js` client in a `Proxy` that times every query and logs (`logger.warn({ sql, duration_ms, params_count }, "slow query")`) any query taking **≥ 500ms**. The timing branch attaches a **rejection handler as well as a fulfilment one** — see the note below. Wired in once, in `core/db/client.ts`, ahead of the Drizzle instance — every query issued through `db`, anywhere in the app, is covered. The Postgres client itself is a `global`-cached singleton outside production to avoid connection-pool exhaustion across Next.js hot-reloads (`postgres(url, { max: 10, idle_timeout: 20, connect_timeout: 10 })`). That "outside production" test reads `NODE_ENV`, which is one reason the Docker image bakes `NODE_ENV=production` in rather than leaving it to the env file — the `worker` and `migrate` containers are plain `node` and have no framework to default it.

> **Fixed 2026-08-13: every failed query raised an unhandled rejection.** The timing branch was `void Promise.resolve(result).then(onFulfilled)` with no second argument, which forks a promise nobody owns. A caller's own `try/catch` could not suppress it — it is a separate chain — so any query error was reported twice: once to the caller, once as an `unhandledRejection`. Next traps the event and logs it, so in the app it looked like noise; a bare Node process (the worker) would terminate on it. Found when the containerised app logged `⨯ unhandledRejection: relation "__drizzle_migrations" does not exist` on every readiness probe. Covered by `slow-query-logger.test.ts`, which asserts no `unhandledRejection` fires and that the caller still sees the rejection.

The migration runner (`core/db/migrate.ts`) deliberately opens its **own** `postgres(url, { max: 1 })` connection rather than reusing this singleton: migrations run one at a time and the process exits immediately afterwards, so a pool of ten would just leave nine idle connections to time out.

## Read caching

`features/overview/services/overview-cache.service.ts` (added 2026-08-20) wraps every organization-overview query in `shared/utils/ttl-cache.ts`: 30-second TTL, 5-minute staleness ceiling, one cache per query so nothing needs an `unknown` cast.

**Why a cache rather than a faster query.** Measured on staging at 1.3M events, one overview load costs ~2 s of database CPU. That is fine for one reader and does not survive a hundred: 100 readers on a 30-second refresh means 200 loads a minute, ~6.8 cores, for *one answer computed two hundred times*. Reducing the two message-keyed queries to zero would leave ~0.29 cores — real headroom, but still 200 identical computations a minute, and at 1,000 readers the same residue is ~2.9 cores. The rollup (§16.1 Stage D) made those numbers **identical across readers**, which is the precondition that makes them shareable at all.

**Keyed on the preset, never on a resolved range.** `resolveRange()` returns `to = new Date()`. A resolved range in the key is unique to the millisecond, so the hit rate would be exactly zero — a cache that appears to work and does nothing. The route resolves the range and passes it alongside the preset; the range is captured in the compute closure and used only if the query actually runs, so a background refresh uses a range resolved microseconds earlier rather than a stale one.

The route continues to call `resolveRange()` itself because it lives in `features/dashboard`, and a feature importing another feature violates `PROJECT.md` §2.1 where a route composing two of them does not.

The key also carries the project scope, which makes it an authorization boundary — see [security.md](security.md#cached-reads-and-the-scope-in-the-cache-key). Under `E2E_MODE` both timings collapse to 1 ms so no spec can be served a stale value — see [misc.md](misc.md#testing).

**One call per answer, not per section.** `getProjectSummaries` was split into `getProjectStats` and `getProjectTopMessages` on 2026-08-20, with a cache entry each. They were one function returning one map behind one promise, which meant the ~30 ms rollup-backed half could not be served until the ~954 ms message aggregation was also ready — so the KPI row, whose numbers are entirely rollup-backed, waited on a message it does not display. The top message now streams into a per-row `Suspense` boundary inside the projects table.

This is a latency change, not a cost one: measured after the split, a page load still issues 10 statements and `rollupBoundary` still runs 3 times. Nothing got faster; the cheap things stopped waiting.

The boundary lives on the server even though the projects table is a client component (its Cards/Table toggle is `useState`). A Server Component cannot render *inside* a client one, but it can be passed *into* one as a prop — the documented slot pattern — which is how `OverviewProjectsPanel` hands each row a ready `ReactNode`.

**What it does not do.** It bounds how often an expensive query runs, not what it costs. The two message-keyed aggregations that the rollup cannot serve still account for ~96% of the page's database time when they do run, and they grow with the data. Deliberately in-process, not shared between instances: at one deployable and ~100 readers, a per-instance cache costs one recomputation per instance per TTL. See `PLAN.md` §17 for why an external store stayed out.
