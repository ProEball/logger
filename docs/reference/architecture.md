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
| `core/db/` | Drizzle schema (`schema/`), Postgres client singleton + slow-query-logging middleware (`middleware/`), and `bootstrap.ts` — the standalone entrypoint that applies **both** stores' schemas. There is no `migrations/` folder and no migration-status check; see [Schema and the bootstrap](#schema-and-the-bootstrap) |
| `core/clickhouse/` | ClickHouse client singleton (`client.ts`), the DDL statement splitter (`ddl.ts`), `schema.sql` — the events schema — and the **query layer**: `params.ts` (the parameter bag every bound value goes through), `filter-compiler.ts` (an `EventFilters` to a bound `WHERE` clause), `search-query.ts` (the message-search grammar, pure), `event-row.types.ts`, `from-event-row.ts` (a stored row back to an `Event`, plus the `SELECT` list that produces it) and `tables.ts`. See the note below on why query-building lives in `core/` |
| `core/env/` | Validated environment variables (`@t3-oss/env-nextjs` + Zod) |
| `core/i18n/` | Typed dictionary lookup (`t(key)`), English-only today, falls back to returning the key itself rather than throwing if a key is missing |
| `core/logger.ts` | App-wide pino logger — see [misc.md](misc.md#app-logger) for an important dead-code note (two other logger files exist and are unused) |
| `core/store/` | Redux Toolkit store: `theme`, `org`, `project`, `user` slices, plus client-side hydrator components that seed Redux from server-fetched data |
| `core/theme/` | Theme resolution (`dark`/`light`/`system`), cookie persistence, no-flash inline script, `ThemeProvider` |
| `core/worker/` | pg-boss bootstrap (`worker.ts`), the standalone worker container's entrypoint (`main.ts`), its liveness file-touch (`health-touch.ts`) and signal handling (`shutdown.ts`) — see [Background jobs](#background-jobs) below |

### `features/` — one folder per feature

Each feature follows: `actions/` (Server Actions), `components/` (per-component subfolders), `services/` (data access / business logic), `utils/` (pure functions), and where relevant `jobs/` (pg-boss job definitions) and `hooks/`.

**`alerts` is the only feature with a `jobs/` folder** since 2026-08-26. `ingest` had one until Phase 4 deleted both of its jobs along with the Postgres tables they maintained.

| Feature | Responsibility |
|---|---|
| `alerts` | Alert rule CRUD, evaluation, webhook delivery |
| `api-keys` | API key generation/hashing/storage/revocation/rate-limit config |
| `auth` | Login, logout, setup wizard (first-run bootstrap), password reset, account/session management |
| `dashboard` | Per-project metrics aggregation (time-bucketed charts, breakdowns) |
| `events` | Events list/detail UI, filtering, keyset-paginated query service |
| `ingest` | The event-ingestion pipeline: API-key auth, validation, attribute-type enforcement, enrichment, insert. It owned three derived read-path tables and two maintenance jobs until 2026-08-26; ClickHouse maintains its own aggregates, so the feature has no `jobs/` folder any more |
| `organizations` | Organization CRUD, membership, invitations |
| `overview` | Org-level (cross-project) rollup dashboard. Per-project row assembly and the top-errors window clamp live in `overview/utils/`; they were in `app/[org]/(org-shell)/page.tsx` until 2026-08-20, which put business logic in a route (against `PROJECT.md` §2.3) and left it untestable. Search-param parsing and chart bucket widths lived there too until 2026-08-25, when they moved to `shared/utils/dashboard-filters.ts` — they were never overview-specific, and keeping them here meant the project dashboard maintained a second copy of both. The route still performs the data-loading fan-out, which §2.3 permits — and since 2026-08-20 it passes each query down as an **unawaited promise** so the page streams section by section. Keeping the fan-out in the route is deliberate: it composes `projects` and `alerts`, and moving that into the feature would make one feature import two others, against §2.1. Since 2026-08-20 the fan-out targets a read-through cache rather than the service directly — see [Read caching](#read-caching). The service it fronts is now `shared/services/event-aggregations.service.ts`, shared with the project dashboard; and since 2026-08-25 the cache is shared too — `features/overview/services/` is now **empty**. |
| `projects` | Project CRUD with soft delete and per-org unique slugs |
| `roles` | RBAC role CRUD, permission-matrix UI, system-role seeding |

### `shared/` — cross-feature library

- `shared/components/` — the UI kit (Button, Table, Modal, Drawer, Combobox, CommandPalette, JsonTree, KeyValue, LevelBadge, LogRow, Timeline, Toast, Tooltip, Sidebar, Topbar, etc.). Its top-level `index.ts` barrel is the **only** allowed barrel file in the project (per-component barrels elsewhere are disallowed by convention).
- `shared/permissions/` — the RBAC engine: `registry.ts` (permission string catalogue), `groups.ts` (UI grouping), `check.ts` (`hasPermission`), `guards.ts` (`assertPermission`, `assertOwner`), `hooks.ts` (`usePermission` client hook). See [users-roles.md](users-roles.md).
- `shared/hooks/`, `shared/types/`, `shared/utils/`, `shared/services/` — generic reusable code.
  - `shared/types/event.types.ts` — `Event` and `NewEvent`, **hand-written since 2026-08-26**. Both were `typeof events.$inferSelect` off the Drizzle table that no longer exists. Writing them out is not a loss: inferring a domain type from a storage schema made every `jsonb` column arrive as `unknown`, so each component reading one spent an `as Record<string, unknown>` — a cast §4 allows only with a reason — working around a type that was never accurate.
  - `shared/utils/query-cache-key.ts` — the cache key for a cached read, shared by both pages. See [security.md](security.md#cached-reads-and-the-scope-in-the-cache-key): the key is an authorization boundary, and a second copy of one is the last thing this tree needs.
  - `shared/utils/read-cache-settings.ts` — the 30-second TTL and 5-minute staleness ceiling both read caches use, and the `E2E_MODE` collapse. It lived in `features/overview` until 2026-08-21, which forced `features/dashboard` to import across the feature boundary to reuse it.
  - `shared/services/event-aggregations.service.ts` — the aggregations behind both dashboards, every one scoped by `projectIds: string[]`. Added 2026-08-25, **on ClickHouse since 2026-08-26**. It has absorbed, in order: `getOrgEventBuckets` + `eventsPerMinute` → `eventBuckets`; `getOrgLevelBreakdown` + `levelBreakdown` → `levelBreakdown`; `getOrgTopErrors` + the project dashboard's `topMessages` → one `topMessages`.

    It went from **1,449 lines to ~660** in Phase 4, and the half that disappeared was not about the questions. It was about a summary table being a *different table* from `events`: a watermark, a coverage interval, a raw tail unioned above it, four floor checks and two implementations each of `topMessages` and `topSources` chosen at runtime. Every public signature is unchanged, so no caller and no component moved.

    **`rollup-boundary.service.ts` lived beside it until then** and is deleted with the tables it described. One finding from it transfers, because the same mistake is available in any coverage check: it originally required every requested project to have a watermark row, which is a **different question** from whether the project has events — a project that never received one has no row, so an organization containing a single quiet project sent its whole overview to the raw-events path. Staging had exactly that, which meant an optimisation nobody could see was never running in production.

    The last of those is the interesting one, because the two queries looked least alike: one ranked every level for a single project and one ranked errors across an organization while attributing each row to a project. The differences turned out to be **scope, a level predicate, and whether an owning project was computed** — none a reason for two implementations of the hardest query on either dashboard. `levels` is an option each caller passes as a constant, never something a request supplies: the overview's removed level filter could once widen its own "top errors" widget to any levels at all. The organization page is the project page over several projects: the project route passes `[id]`, the org route passes all of them, and nothing else about the queries differs. Two copies of a union-over-rollup query is two places for the next `ORDER BY` defect to hide, and this tree has already paid that bill three times.
  - `shared/utils/event-buckets.ts` — the `EventBucket` shape and the pure arithmetic over it (`errorsIn`, `fillBuckets`, `hasEnvFilter`).

    **Split from the service because the build enforces it.** The service imports `@/core/db/client` → `postgres` → `fs`, so a `"use client"` component importing a *value* from it fails the production build with `Module not found: Can't resolve 'fs'`. `OrgVolumeChart` was a client component and needed `errorsIn`. The previous code imported only a `type`, which is erased at compile time and hid the boundary entirely — types cross freely, values do not. Caught by `npm run build`, not by review.
  - `shared/components/DashboardFilterBar/` — range, environment and auto-refresh, for both dashboards, and **nothing else**. Moved out of `features/overview/` on 2026-08-25, when the project dashboard's own `DashboardHeader` was deleted along with `useDashboardRange`. That header carried a **four-preset** segmented control against the overview's six, so a link from one dashboard to the other could land on a range the destination could not display.

    It briefly carried `leading` and `trailing` slots so the project dashboard could keep its title, live rate and "+ New alert" link on that row. Both slots were removed the same week, for the reason the header was: the title is unbounded and the pills are a fixed-width run, so any real project name crowded them. The title and rate moved up to the application top bar (`ProjectPulse`); the alert shortcut was deleted rather than moved, being a third copy of a button the alerts page shows in its header and again in its empty state. Both dashboards now pass the same three props.
  - `features/projects/components/ProjectPulse/` — the project's name and live rate, rendered into the application top bar's `left` slot by `app/[org]/[project]/layout.tsx`. `OrgTopBar` takes it as a `ReactNode` rather than importing it, so `features/organizations` does not reach into `features/projects`.

    **Living in a layout has two consequences worth knowing.** It is no longer filtered by environment — a layout cannot read `searchParams` in the App Router — which reframes it as a heartbeat for the project rather than a statistic about the current view, and is what makes it sensible on the settings and API-key pages at all. And it refreshes only when the page does: a shared layout is preserved across navigation between its children, so on pages with no auto-refresh control the reading is a snapshot from arrival. Giving it a timer of its own would mean a client component polling a Server Action on every project page.

    The rate query is started in the layout and passed down **unawaited**; `ProjectPulse` holds the `Suspense` boundary, and its section renders `null` on failure rather than throwing. That is the one place in this tree where a failed aggregation is deliberately reduced to a log line instead of reaching `error.tsx`: the layout wraps every project page, so an unhandled rejection here would replace settings, alerts and API keys with an error screen because a decorative counter could not be computed.
  - `shared/utils/live-rate.ts` — formats the last-minute rate. Below 1 it shows two decimals rather than rounding, because a quiet project rounding to `0` reads as "nothing is arriving". It was `liveRate` in `features/dashboard/utils/dashboard-kpis.ts` until the rate left the dashboard for the top bar.
  - `shared/components/EventChart/` — the chart both dashboards draw: `line` mode for the overview's per-project error ratio, `stacked-area` for the project's per-level volume. It replaced `OrgVolumeChart` and `EventsPerMinuteWidget`, which held two copies of the axis formatting, the tick thinning and the tooltip.

    **It takes shaped points, not buckets**, because both callers are Server Components and it is a client one — an accessor function cannot cross that boundary. The shaping moved to `shared/utils/chart-points.ts`, which turned out to be the better split on its own terms: that arithmetic had lived inside two client components where no test could reach it, and now has sixteen.
  - `shared/utils/dashboard-filters.ts` — the preset list, the URL parser, range resolution and the chart bucket widths, for **both** dashboards. Added 2026-08-25, replacing `features/overview/utils/overview-filters.ts` and `features/dashboard/utils/dashboard-range.ts`, which are deleted.

    Range alone had four preset lists before it: `TIME_RANGE_PRESETS` in the shared schema, `DASHBOARD_PRESETS` deriving from it, `OVERVIEW_PRESETS` restating the same six values as a fresh literal, and `DASHBOARD_SEGMENT_PRESETS` offering four of them in the project header. The 2026-08-21 consolidation recorded in the deleted `dashboard-range.ts` fixed exactly this problem — on one page, while the other kept its own copy. `DASHBOARD_SEGMENT_PRESETS` is gone with it, so the project dashboard's header now offers all six presets rather than four; the claim that six buttons did not fit was never true of the overview's bar, which has shown six in the same height since it was built.

    It also holds `BUCKET_SECONDS`, a table replacing `pickBucket()`. That function chose among four widths (1m/1h/12h/1d) by range length, and at 6 hours landed on the 1-hour width — **six marks to describe six hours**, against twenty-four on the overview for the same window. Nothing recorded that as intended; it falls out of the step function. The table has one cell per preset per density and every cell draws 12–60 points. The two densities differ in exactly one cell (`1h`), which is the project dashboard's live minute-by-minute tail; a test asserts that it stays the only difference. Both routes read `bucketSecs` from the parser and pass it to the query; `pickBucket()` and the rest of `features/dashboard/utils/aggregation-utils.ts` were deleted the same day. The project dashboard's 6h chart went from six points to twenty-four and its 7d from fourteen to twenty-eight.
  - `shared/utils/ttl-cache.ts` — a bounded in-process cache with **single-flight** recomputation, **stale-while-revalidate**, and a hard staleness ceiling. Added 2026-08-20 for the overview's read path (see [Read caching](#read-caching)). All three properties exist for a named failure: without single flight a cache makes a stampede worse rather than better, since every reader misses at the same instant; without serving stale, one reader per TTL pays the full recomputation; without the ceiling, a database that has been down for an hour is indistinguishable from one that is up. The clock is injectable so tests do not sleep.
  - `shared/hooks/use-auto-refresh.ts` and `shared/components/AutoRefreshControl/` — the interval-reload control, moved out of `features/events/` on 2026-08-20. It had three consumers by then (the events list, the project dashboard, the org overview), and the first two reached it by importing across features, which §2.1 forbids. Its i18n keys moved from the `events` namespace to `common` for the same reason: a shared component reading a feature's dictionary is the same violation in another medium.

    Note what the move did **not** remove: the control still imports `updatePreferencesAction` from `features/auth`, so a `features → features` arrow became a `shared → features` one. `shared/components/AppShell/parts/ThemeSwitcher.tsx` already does the same, so this is the established shape rather than a new exception — but no rule in `PROJECT.md` sanctions it, and a shared component that reaches into a feature is a dependency edge pointing the wrong way. Fixing it properly means the preferences action moving somewhere both can see; recorded here rather than done, because it touches the theme switcher too.
  - `shared/hooks/use-filter-params.ts` — URL-backed filter state with an **optimistic selection** and an `isPending` flag, added 2026-08-25. Both dashboards keep their filters in the URL, and the App Router does not commit a URL until the new payload is ready — so a control reading its selection from `useSearchParams()` shows no change at all on click: the chip does not restyle, and a transition holds the current UI so no `Suspense` fallback appears either. Empty string means "parameter absent"; parameters the hook was not told about are preserved across a write.

    It exists in `shared/` because the private version did not stay fixed. The same defect was diagnosed and fixed inside `features/dashboard/hooks/use-dashboard-range.ts` on 2026-08-22, and the org overview's filter bar — which had it too — was still pushing a URL bare three days later, because the fix was one feature's private implementation detail. `use-dashboard-range.ts` was briefly a typed wrapper over this hook and is now deleted outright, along with the segmented control it drove.

    What turned it up is worth recording: benchmarking the overview's SQL with an environment filter active. The queries came back in 19–25 ms on a 500k-event corpus, which cannot account for a wait anyone would report — so the wait being reported was the missing feedback rather than the query. See [widgets.md](widgets.md#organization-overview--org).
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

## The two stores

Since 2026-08-26 the application talks to **two** databases.

| Store | Holds | Client |
|---|---|---|
| **Postgres** | users, sessions, accounts, organizations, roles, organization_members, invitations, projects, api_keys, alert_rules, alert_notifications, attribute_key_types, `pgboss.*` | `drizzle-orm` + `postgres.js` (`core/db/client.ts`) |
| **ClickHouse** | `events` — and nothing else | `@clickhouse/client` (`core/clickhouse/client.ts`) — raw SQL, no ORM |

**The split is clean as of Phase 4 (2026-08-26).** Events are written to ClickHouse and read from ClickHouse; Postgres holds no event data and no table derived from it. Six tables were deleted in that phase — `events`, `event_rollup_minutes`, `rollup_state`, `event_template_rollup`, `message_templates` and `project_environments` — along with the two pg-boss jobs that maintained them.

**What still crosses the boundary**, and it is always the same shape: a question about *projects* asked of Postgres beside a question about *events* asked of ClickHouse, issued concurrently and joined in TypeScript. The events read path's soft-delete check is one (see [logging.md](logging.md#where-an-event-is-read)); the benchmark harness picking the busiest organization is another. There is no query that joins the two, and there cannot be.

### Query-building for ClickHouse lives in `core/`, not in a feature

`PROJECT.md` §7 puts data access in a feature's `services/`, and that still
holds — `listEvents` and `countMatchingEvents` are services. What moved to
`core/clickhouse/` is the piece *underneath* them: turning an `EventFilters`
into a bound `WHERE` clause.

It is there because two features need it. `features/events` reads pages and
facets, `features/alerts` counts matches for a rule, and a feature may not
import another feature (§2.1). Before Phase 3 they had a clause builder each —
the same eleven fields written twice, with no test comparing them. That is the
shape of duplication that gave `topMessages` two implementations and two
answers.

It also concentrates the parameter-binding rule in one file with its own tests
rather than spreading it across every service that queries `events`; see
[security.md](security.md#clickhouse-queries-parameter-binding-is-now-a-rule-not-a-library-guarantee).

**Phase 4 gave the layer a second tenant and split one piece out.** The
dashboard aggregations do not compile an `EventFilters` — their scope is a
project list, a range and an optional environment — but they build SQL by hand
in exactly the same way, so the parameter bag became `core/clickhouse/params.ts`
and both use it. `from-event-row.ts` moved here from `features/events/utils/` at
the same time, when `recentErrors` in `shared/services/` became its second
caller: neither `shared/` nor another feature may reach into `features/events`.

The pattern to take from it: what lands in `core/clickhouse/` is what the
**second** caller makes cross-cutting, not what looked reusable in advance.

**There was a dual write for two phases**, and it is worth recording why rather than only that it existed. Writing only to ClickHouse would have left every read surface staring at an empty Postgres table for the length of Phases 3 and 4, so a regression introduced there could not have been told apart from the breakage put in on purpose. It also meant both stores held the **same rows** from one enrichment pass, so each rewritten read could be checked against the one it replaced. It cost about ten lines and it is gone.

Its named cost is gone with it: there was no transaction across the two stores, so a request failing after the ClickHouse write left the event in one and not the other and returned `500`. One store, one outcome.

Both are created from empty — see [Schema and the bootstrap](#schema-and-the-bootstrap).

## Database schema (Postgres)

Schema source: `core/db/schema/*.ts` (Drizzle), barrel-exported from `core/db/schema/index.ts`. It is rendered to `db/schema.sql` by `npm run db:schema` and applied by `core/db/bootstrap.ts` — there are no migrations, see [Schema and the bootstrap](#schema-and-the-bootstrap).

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

### ~~Events (partitioned)~~ — deleted 2026-08-26

The Postgres `events` table is gone (Phase 4 of `docs/features/09-clickhouse.md`).
See [The ClickHouse `events` table](#the-clickhouse-events-table) below and
[logging.md](logging.md#the-events-table) for the domain shape.

One property went with it and has **no replacement**: events referenced
`projects.id` with `ON DELETE RESTRICT`, so a project could not be hard-deleted
while it still had events. ClickHouse has no foreign keys. Nothing is at risk
today — soft delete via `deletedAt` is the only delete path in the UI, and
`deleteProjectAction` uses it — but the database no longer enforces it. Recorded
as a known limitation in [security.md](security.md).

### Alerts

| Table | Key columns | Notes |
|---|---|---|
| `alertRules` (`alert_rules`) | `id`, `projectId` CASCADE, `name`, `description`, `filter` (jsonb — same shape as the events-list filters), `condition` (jsonb — `{type:"threshold", count, windowMinutes}`), `channels` (jsonb — webhook configs), `state` (`"ok"｜"firing"`), `stateChangedAt`, `lastEvaluatedAt`, `lastMatchCount`, `enabled` (bool), `notifyOnResolve` (bool, default `true`), `createdBy` → `users.id` SET NULL, `version` (int, default `1`, optimistic concurrency) | Partial index `(projectId) WHERE enabled = true` |
| `alertNotifications` (`alert_notifications`) | `id`, `alertRuleId` CASCADE, `triggeredAt`, `state`, `payload` (jsonb), `channelType`, `channelTarget`, `deliveryStatus` (`pending｜delivered｜failed｜retrying`), `deliveryAttempts`, `deliveryLastError`, `deliveryHttpStatus`, `deliveredAt` | Index `(alertRuleId, triggeredAt)` |

### Attribute type registry

| Table | Key columns | Notes |
|---|---|---|
| `attributeKeyTypes` (`attribute_key_types`) | PK `(projectId, key)`, `type` (text: `"string"｜"number"｜"boolean"`, app-enforced only — no DB check constraint), `createdAt` | Records the **first-seen** JSON type per `(project, attribute key)`, used to reject subsequent type-mismatched values at ingest — see [logging.md](logging.md#attribute-type-enforcement) |

**Three tables left this section on 2026-08-26** — `event_rollup_minutes`, `rollup_state` and `project_environments`, deleted with the rollup they served. `attribute_key_types` is the one derived table that stays, and the difference is what it is for: it **validates** an event on the way in rather than summarising events on the way out, so it has no ClickHouse equivalent to be replaced by. It is also the only Postgres query left on the ingest path, and unlike the three that are gone, its failure is **not** swallowed — a registry that cannot be consulted must reject the event, not wave it through.

### Schema and the bootstrap

**There are no migrations.** `core/db/migrations/0000`–`0015`, `core/db/migrate.ts` and `core/db/migration-status.ts` were deleted on 2026-08-26. Each store has one file describing its **end state**, and `core/db/bootstrap.ts` applies both:

| File | Store | Maintained by |
|---|---|---|
| `db/schema.sql` | Postgres | Generated by `npm run db:schema` (`scripts/build-schema.mjs`). Never hand-edited |
| `core/clickhouse/schema.sql` | ClickHouse | Hand-written |

**`db/events.sql` was a third file and is gone** (2026-08-26). It held the one table Drizzle could not emit — `PARTITION BY RANGE`, the composite primary key that forces, two GIN indexes and the `pg_partman` registration — and `build-schema.mjs` stripped every `"events"` statement out of the generated DDL to splice it in. That strip had a subtlety worth remembering even though its subject is gone: it matched the **quoted** identifier, because an unquoted `/events/` would have taken `"event_rollup_minutes"` and `"event_template_rollup"` with it. The Postgres baseline is now entirely generated.

`scripts/build-schema.mjs` runs `drizzle-kit export` over `core/db/schema/index.ts`, which emits the whole schema as a diff against an empty database. It then does one thing the generator cannot:

- **Makes each statement idempotent**: `CREATE TABLE`/`CREATE INDEX` gain `IF NOT EXISTS`, and `ADD CONSTRAINT` — which has no such form in any Postgres version — is wrapped in `DO $ … EXCEPTION WHEN duplicate_object THEN NULL; END $`. The bootstrap re-applies the whole file on every start, so "already exists" is the normal case rather than an error to be guessed at.

Unit-tested in `scripts/build-schema.test.mjs`.

**How each side is applied.** Postgres gets the file whole, through `sql.unsafe(ddl).simple()` — one simple-protocol query, which Postgres runs inside a single implicit transaction, so the schema arrives whole or not at all. ClickHouse has no transactional DDL and its HTTP interface takes one statement per request, so `core/clickhouse/ddl.ts` splits the file first (comment- and string-literal-aware, unit-tested in `ddl.test.ts`). A ClickHouse failure halfway therefore leaves the earlier statements applied; every statement is `IF NOT EXISTS`, so the fix is to correct the file and re-run. Both sides refuse an empty file rather than treating it as success — applying nothing looks exactly like applying everything, and the container would exit 0 and let the app start against a database with no tables.

**Where the code lives, and why it is split in two.** `core/db/apply-schema.ts` holds the work and takes every boundary it touches as a parameter — both clients, the DDL splitter and the file reader — so `apply-schema.test.ts` needs no module mocking at all. `core/db/bootstrap.ts` is the entrypoint: it calls `main()` at module scope and `process.exit(1)` on failure, so it must not be importable, and it carries a `test-exempt` comment saying so. Guarding that call with `require.main === module` would make it testable at the cost of letting a bundler quirk turn the bootstrap into a silent no-op — a worse failure than an untested five-line function.

**Four consumers, one file.** `core/db/bootstrap.ts` (the `bootstrap` container and `npm run db:bootstrap`), `itest/support/global-setup.ts`, `scripts/bootstrap-e2e.mjs` and `scripts/seed-bench.mjs` all apply `db/schema.sql`, and all but the first apply `core/clickhouse/schema.sql` too. None of them defines tables of its own.

**Two of them now drop and recreate their database rather than creating it when missing** (2026-08-26): the integration setup and the e2e bootstrap. An additive end-state file cannot *remove* a table, so a table deleted from the schema lives on in an existing database for ever — and Phase 4 deleted six. One of them, `events` with its `ON DELETE RESTRICT` foreign key, then broke `resetDb()` in every e2e spec with a constraint violation over rows nothing writes any more: correct code, correct file, wrong database. Both databases are disposable and seeded from scratch, so tearing them down is the cheap answer. **The dev and production databases are not**, and there the answer is the one below.

**What it costs, and it was collected on 2026-08-26.** A schema change against a database holding rows has no upgrade path. Phase 4 removed six tables, and applying the new baseline to an existing database leaves all six in place — inert, but not harmless: `events`' foreign key to `projects` blocks deletes. **A developer with an existing `logger` database must recreate it**, which is what `docker compose -f docker-compose.dev.yml down -v` followed by `npm run db:bootstrap` does. Nothing detects the situation and nothing warns.

That is exactly the cost `PLAN.md` §17 (2026-08-26) named when the migration chain was dropped, arriving one phase later. The drop-and-recreate that makes this simple is safe only while nothing is deployed — true today, because the staging host was destroyed, and it will stop being true.

**The history is in git, not here.** The deleted chain's per-migration notes went with it; where a table's shape only makes sense with its history, that history is kept in the table's own row above.

### ~~Template rollup tables~~ — deleted 2026-08-26

`event_template_rollup` and `message_templates` are gone with the rest of the
rollup machinery. What they existed for — grouping messages by *shape* rather
than by text — survives as two columns on the ClickHouse event row,
`template_hash` and `message_template`. See
[logging.md](logging.md#the-template-rollup) for what moved where and why the
display text is now stored per row rather than joined from a vocabulary table.

## The ClickHouse `events` table

DDL: `core/clickhouse/schema.sql`. **The only place events live**, written by the ingest path and read by every surface that shows one. The reasoning for each choice is in `docs/features/09-clickhouse.md` §3–§5, and §14 records what was measured rather than argued.

```
ENGINE = MergeTree
PARTITION BY toYYYYMM(timestamp)
PRIMARY KEY (project_id, timestamp)
ORDER BY    (project_id, timestamp, id)
```

**`ORDER BY` and `PARTITION BY` are the only two things here that cannot be changed** without a new table and a full re-insert. Everything else — columns, codecs, skip indexes, TTL, projections — is alterable on a live table.

- **The sort key leads on time, and `level` is deliberately not in it.** The alternative, `(project_id, toStartOfHour(timestamp), level, timestamp, id)`, was loaded alongside it and lost *every* query variant including the level-filtered one it existed to serve, by 23×. The reason generalises: every list query ends `ORDER BY timestamp DESC LIMIT 51`, and a `LIMIT` over a `DESC` sort cannot terminate early when the sort key does not lead on time — so the whole range is read and sorted regardless of what `level` prunes.
- **`PRIMARY KEY` is shorter than `ORDER BY`.** The sparse index is held in memory and a random UUID contributes nothing to granule pruning; `id` is in the sort key only to make keyset pagination deterministic.
- **Monthly partitions, not daily.** Daily partitioning of a log table is a named anti-pattern — 365 partitions a year, growing without bound. Retention will be a TTL (Phase 6), not `DROP PARTITION`, because per-project retention makes partitions non-homogeneous anyway. **Nothing expires today**: the `retention_days` column exists with its default and the TTL clause does not, and pg_partman's 30-day drop went with the Postgres table on 2026-08-26.
- **Column types**: `level` is `Enum8` (one byte, validated at insert, and *ordered*, so `level >= 'error'` works natively), `ip` is `IPv6` (v4 stored v4-mapped), `source`/`environment`/`release`/`error_type` are `LowCardinality(String)`, `user_agent` is plain `String` because browser traffic would blow past the 10k threshold where LowCardinality degrades. **No `Nullable` anywhere** — empty string means absent.
- **`attributes` is the `JSON` type**, not three `Map`s. A Map is two parallel arrays, so reading one key reads every key in the granule; a JSON path is its own subcolumn. Measured at 18 keys per project: 16× less read and 12× faster, and JSON's cost did not move when the key count grew six-fold while the Map's tripled.
- **`message_lower` is `MATERIALIZED lowerUTF8(message)`**, backing a `tokenbf_v1` index. It costs a full duplicate of `message`.
- **`message_template` is a third near-copy of the message text**, added 2026-08-26 and written by ingest rather than materialised — the normaliser is TypeScript and has no SQL equivalent. It is what the top-messages widgets label a group with, and the alternative was to display `any(message)`: one arbitrary instance standing for ten thousand. Its cardinality is far lower than `message`'s (18,080 distinct templates measured across the whole install) and the sort key puts near-identical values in one granule, which is the case ZSTD is best at.
- **Skip indexes**: bloom filters on `trace_id`, `session_id`, `request_id`, `user_id`, `error_type`, `template_hash`. Postgres has an index on *none* of the four correlation ids today. Nothing on `level`/`source`/`environment`/`release` — they are `Enum8`/`LowCardinality` and appear in every granule, so a set index would skip nothing.

**Deduplication is opt-in and had to be turned on explicitly.** The table carries `non_replicated_deduplication_window = 10000`. Without it, `insert_deduplication_token` is accepted and does **nothing** — deduplication is a `Replicated*` feature unless a plain `MergeTree` opts in, and the default is `0`. The window is a count of the last N inserts **per partition**, with no time dimension; the `_seconds` and `_for_async_inserts` variants exist only for Replicated tables. So the size is a rate decision, and 10,000 is ~86 seconds at the 10M events/day target if every event arrives on its own. It costs ~60 bytes an entry (~600 KB) and insert throughput was identical at 100, 1,000 and 10,000.

One side effect worth knowing, because it is a property of the setting rather than of any code: turning the window on also enables ClickHouse's **checksum** deduplication (`insert_deduplicate` defaults to `1`), so a byte-identical block is discarded even with no token. In practice that fires only when the very same enriched batch is inserted twice, since every row carries its own UUIDv7.

**Two operational limits, both measured, both worth knowing before they bite:**

- **The JSON column's ceiling is the number of distinct attribute key *names* across the whole install**, not the amount of data. Memory per path is the binding limit and it starts failing operations around 180 paths — an order of magnitude below `max_dynamic_paths` (set to 2048), which will therefore not warn in time. Ten projects at 18 keys is 180; a hundred projects is 1,800, which could not be loaded at all under a 3 GiB budget. Width is nearly free; path count is not. Treat the install-wide distinct key count as a monitored quantity with an alarm well below 1,000.
- **Do not ask ClickHouse what paths exist.** `JSONAllPaths()` materialises every path for every row and failed from 360 paths up. `attribute_key_types` in Postgres is the catalogue; the JSON column is storage.

Not built yet, and each gated on measuring its cost first (Phases 5–6): the `p_minute` projection, the `events_by_template` and `events_by_correlation` materialized views, and the per-project TTL.

## ~~Events partitioning (Postgres)~~ — deleted 2026-08-26

`events` was a native Postgres partitioned table (`PARTITION BY RANGE (timestamp)`),
managed by **pg_partman** at one-day intervals with seven days premade and a
30-day retention that dropped whole partitions. All of it is gone with the
table: `db/events.sql`, `core/db/schema/events.ts`, the `partman-maintenance`
job, the `pg_partman` extension, and the custom `db/Dockerfile` that existed
only to install it. Both compose files run stock `postgres:16` again.

**Retention has no replacement yet, and that is a live gap.** Partition drop was
the only thing expiring events; the ClickHouse table carries a `retention_days`
column with a default of 30 and **no TTL clause**. Phase 6 wires it up. Until
then nothing expires — see [security.md](security.md) and `09-clickhouse.md` §9.

The ClickHouse table partitions **monthly**, by `toYYYYMM(timestamp)`, and
creates partitions on insert. Daily partitioning of a log table is a named
anti-pattern there — 365 partitions a year, growing without bound — and
retention is a TTL rather than a partition drop because per-project retention
makes partitions non-homogeneous anyway.

## Background jobs

`core/worker/worker.ts` owns a module-level `pg-boss` singleton (`getBoss()` / `startWorker()` / `stopWorker()`). It is started either:
- **In-process**, inside the Next.js server, when `WORKER_IN_PROCESS=true` — wired via `instrumentation.ts`'s Next.js `register()` hook (only runs when `NEXT_RUNTIME === "nodejs"`). A dev convenience.
- As a **separate worker container** in production: `core/worker/main.ts`, bundled to `dist/worker.js` and run as `node worker.js`. See [misc.md](misc.md#deployment).

Both paths call the same `startWorker()`, so a job registered once is picked up by both. That is the point of the split — `main.ts` adds only process concerns (health-touch, signal handling), never job registration.

**Two jobs are registered** (`registerXJob(boss)` calls, in this order):

| Job | Trigger | What it does |
|---|---|---|
| `alert-evaluation` | Cron `* * * * *` (every minute — pg-boss cron has no finer granularity), `singletonKey` | Calls `evaluateAllEnabled(boss)` — evaluates every enabled alert rule, updates state, enqueues `alert-delivery` jobs for state transitions |
| `alert-delivery` | On-demand (`boss.work`, no cron — enqueued by the evaluator) | Delivers one webhook notification, `retryLimit: 3, retryDelay: 30, retryBackoff: true` |

**Two were deleted on 2026-08-26** (Phase 4 of `docs/features/09-clickhouse.md`), and both existed only to maintain Postgres tables that no longer do:

- `partman-maintenance` (hourly) ran `public.run_maintenance()` to advance and prune `events` partitions. ClickHouse creates partitions on insert.
- `event-rollup` (every minute) rebuilt `event_rollup_minutes` from `events` and pruned it. A ClickHouse projection is maintained by the engine inside the table.

Both swallowed their failures and logged at `ERROR`, because a stale dashboard is better than a failed request — the kind of trade a summary table forces and an in-engine aggregate does not. That is the whole of §1.2's argument, visible in one table row.

**Every registrar calls `boss.createQueue(name)` before `schedule()`/`work()`.** pg-boss 12 dropped implicit queue creation; without it both calls violate the foreign key from `pgboss.schedule` to `pgboss.queue` and the worker crashes on startup. `createQueue` is `INSERT … ON CONFLICT DO NOTHING`, so it runs unconditionally on every start.

> **Fixed 2026-08-13.** This was missing, and could only ever fail against a database whose `pgboss.queue` rows did not already exist — i.e. never in a long-lived dev database, and always on a fresh production one. The worker crash-looped on first boot of the new Docker stack; `core/worker/worker.test.ts` now pins both the creation and its ordering relative to `work`/`schedule`.

**Graceful shutdown.** `main.ts` installs SIGTERM/SIGINT handlers (`core/worker/shutdown.ts`) that drain in-flight jobs via `stopWorker()` and exit. The drain is capped at 20s, deliberately under the 30s `stop_grace_period` in compose — past that, Docker SIGKILLs mid-drain. A second signal arriving during the drain is logged and ignored; a drain that throws exits non-zero rather than hanging.

**Liveness.** `core/worker/health-touch.ts` advances the mtime of `/tmp/worker-alive` every 30s from inside the worker process, which the container healthcheck probes. It lives in the process, not a wrapper script, precisely so a dead process cannot keep reporting healthy.

Because `singletonKey` alone isn't bulletproof under a rolling deploy, the `worker` service is pinned to `deploy.replicas: 1` in `docker-compose.yml` as a second safeguard.

## Query performance / observability

`core/db/middleware/slow-query-logger.ts` wraps the raw `postgres.js` client in a `Proxy` that times every query and logs (`logger.warn({ sql, duration_ms, params_count }, "slow query")`) any query taking **≥ 500ms**. The timing branch attaches a **rejection handler as well as a fulfilment one** — see the note below. Wired in once, in `core/db/client.ts`, ahead of the Drizzle instance — every query issued through `db`, anywhere in the app, is covered. The Postgres client itself is a `global`-cached singleton outside production to avoid connection-pool exhaustion across Next.js hot-reloads (`postgres(url, { max: 10, idle_timeout: 20, connect_timeout: 10 })`). That "outside production" test reads `NODE_ENV`, which is one reason the Docker image bakes `NODE_ENV=production` in rather than leaving it to the env file — the `worker` and `bootstrap` containers are plain `node` and have no framework to default it.

> **Fixed 2026-08-13: every failed query raised an unhandled rejection.** The timing branch was `void Promise.resolve(result).then(onFulfilled)` with no second argument, which forks a promise nobody owns. A caller's own `try/catch` could not suppress it — it is a separate chain — so any query error was reported twice: once to the caller, once as an `unhandledRejection`. Next traps the event and logs it, so in the app it looked like noise; a bare Node process (the worker) would terminate on it. Found when the containerised app logged `⨯ unhandledRejection: relation "__drizzle_migrations" does not exist` on every readiness probe. Covered by `slow-query-logger.test.ts`, which asserts no `unhandledRejection` fires and that the caller still sees the rejection.

The bootstrap (`core/db/bootstrap.ts`) deliberately opens its **own** `postgres(url, { max: 1 })` connection rather than reusing this singleton: it applies one file and the process exits immediately afterwards, so a pool of ten would just leave nine idle connections to time out.

`core/clickhouse/client.ts` is the same pattern for the other store — a `global`-cached `@clickhouse/client` outside production, for the same hot-reload reason. It is the *whole* abstraction: there is no Drizzle dialect for ClickHouse, so everything past it is raw SQL and parameter binding becomes a rule rather than a library guarantee. See [security.md](security.md).

## Read caching

`shared/services/event-aggregations-cache.service.ts` (2026-08-25, merging the overview's and the dashboard's) wraps every dashboard query in `shared/utils/ttl-cache.ts`: 30-second TTL, 5-minute staleness ceiling, one cache per query so nothing needs an `unknown` cast.

Merging the two exposed a **latent key collision**: they namespaced keys `overview.*` and `dashboard.*`, and that prefix was the only thing separating two genuinely different questions — the dashboard asks `topMessages` for every level with limit 10, the overview asks it for `error, fatal` with limit 5, and neither `levels` nor `limit` was in the key. A one-project organization and that project's dashboard would have collided the moment the prefixes merged. The fix is two named wrappers with every distinguishing option in the key, not a prefix that encodes which page asked.

**Why a cache rather than a faster query.** Measured on staging at 1.3M events, one overview load costs ~2 s of database CPU. That is fine for one reader and does not survive a hundred: 100 readers on a 30-second refresh means 200 loads a minute, ~6.8 cores, for *one answer computed two hundred times*. Reducing the two message-keyed queries to zero would leave ~0.29 cores — real headroom, but still 200 identical computations a minute, and at 1,000 readers the same residue is ~2.9 cores.

**A faster store does not change that argument, which is why the cache stayed through Phase 4.** Its subject was never the cost of one query but the number of times one identical answer is computed, and ClickHouse computes it just as many times. What the rollup used to supply — every reader seeing the *same* numbers — is now the cache's own property rather than the storage's.

**Keyed on the preset, never on a resolved range.** `resolveRange()` returns `to = new Date()`. A resolved range in the key is unique to the millisecond, so the hit rate would be exactly zero — a cache that appears to work and does nothing. The route resolves the range and passes it alongside the preset; the range is captured in the compute closure and used only if the query actually runs, so a background refresh uses a range resolved microseconds earlier rather than a stale one.

The route continues to call `resolveRange()` itself because it lives in `features/dashboard`, and a feature importing another feature violates `PROJECT.md` §2.1 where a route composing two of them does not.

The key also carries the project scope, which makes it an authorization boundary — see [security.md](security.md#cached-reads-and-the-scope-in-the-cache-key). Under `E2E_MODE` both timings collapse to 1 ms so no spec can be served a stale value — see [misc.md](misc.md#testing).

**One call per answer, not per section.** `getProjectSummaries` was split into `getProjectStats` and `getProjectTopMessages` on 2026-08-20, with a cache entry each. They were one function returning one map behind one promise, which meant the ~30 ms rollup-backed half could not be served until the ~954 ms message aggregation was also ready — so the KPI row, whose numbers are entirely rollup-backed, waited on a message it does not display. The top message now streams into a per-row `Suspense` boundary inside the projects table.

This is a latency change, not a cost one: measured after the split, a page load still issued 10 statements and `rollupBoundary` still ran 3 times. Nothing got faster; the cheap things stopped waiting. (It is **seven** statements since 2026-08-26 — the three `rollupBoundary` calls went with the rollup.)

The boundary lives on the server even though the projects table is a client component (its Cards/Table toggle is `useState`). A Server Component cannot render *inside* a client one, but it can be passed *into* one as a prop — the documented slot pattern — which is how `OverviewProjectsPanel` hands each row a ready `ReactNode`.

**What it does not do.** It bounds how often an expensive query runs, not what it costs. The two message-keyed aggregations accounted for ~96% of the page's database time under Postgres when they did run, and they grew with the data; both group by a `UInt64` fingerprint over one scan now, and **what that costs has not been measured** — `event-aggregations.service.bench.ts` is the rig and Phase 5 is what needs the number. Deliberately in-process, not shared between instances: at one deployable and ~100 readers, a per-instance cache costs one recomputation per instance per TTL. See `PLAN.md` §17 for why an external store stayed out.
