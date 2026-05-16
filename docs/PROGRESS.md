# Progress

> Single source of truth for "where are we right now". Update after every work session.

**Last updated**: 2026-05-11 (DS v0.3 update started)

---

## Current Phase

**Now: Design System v0.3.0 Update (side track)** · `docs/features/ds-v03-update.md`
Status: 🟨 In progress — Phase 1 (Tokens + Fonts) started

**Paused: Feature 08 — Docker packaging** · `docs/features/08-docker-packaging.md`
Status: 🟦 Planned (resumes after DS update)

**Last completed: Feature 07 — Polish (2026-05-09)**
Toast system (central `ToastProvider` + `useToast` hook, Redux-free reducer, ARIA live region `role="region" aria-live="polite"`, per-toast `role="alert"/"status"`); migrated all inline `alert()` / `saved` state to `toast.push()`; 5 skeleton components (`TableSkeleton`, `WidgetSkeleton`, `CardSkeleton`, `ListSkeleton`, `PageSkeleton`) with design-system tokens; `dynamic()` lazy-loading for recharts widgets (EventsPerMinute, LevelBreakdown, EnvironmentBreakdown) and EventDrawer; error boundary components (`GlobalErrorPage`, `NotFoundPage`, `ForbiddenPage`); 12 `error.tsx` / `not-found.tsx` / `loading.tsx` boundary files across all route segments; session revocation on password change (`revokeOtherSessions: true`); E2E test for session revocation (`e2e/auth.spec.ts`); `/api/version` and extended `/api/health/ready` (db, pgboss, ingest, migrations checks); `core/logger.ts` (pino singleton); `slow-query-logger.ts` wraps postgres.js client, WARN at ≥500 ms; `partman-maintenance.job.ts` wrapped in try/catch with ERROR logging; ForbiddenPage wiring — `revokeInvitationAction` returns `{ error? }`, `InvitationsList` converted to client component, `alerts/new/page.tsx` renders `ForbiddenPage` instead of redirect; `EmptyMembers` component for team page; README monitoring endpoints + self-monitoring alert guide; Decision log (10 entries). Manual items deferred: keyboard nav (27), contrast audit (28), EXPLAIN ANALYZE (32). TypeScript clean.

**Last completed: Feature 06 — Alerts (2026-05-09)**
Schema (`alert_rules` + `alert_notifications`, migration 0004), Zod schemas (`shared/utils/event-filters.schema.ts` + `features/alerts/utils/alert-schemas.ts`), `alert-rules.service.ts` (CRUD + `listEnabled` + `listAlertHistory`), `alert-evaluator.service.ts` (evaluateOne with optimistic concurrency on `version`, evaluateAllEnabled with cap-10 concurrency), `build-payload.ts` (webhook JSON with sample events + events_url), `alert-dispatcher.service.ts` (HTTP POST, 2xx/4xx/5xx classification), `alert-evaluation.job.ts` (pg-boss cron `* * * * *`, singletonKey), `alert-delivery.job.ts` (retry options on `send()`), 5 server actions, `alerts.*` i18n namespace, 14 components (`AlertStateBadge`, `AlertRow`, `AlertsList`, `AlertRuleEditor`, `AlertRuleEditorTabs`, `FilterBuilder`, `ConditionEditor`, `WebhookChannelForm`, `ChannelsEditor`, `NotificationOptions`, `SaveBar`, `AlertHistoryTable`, `AlertNotificationRow`, `DeliveryStatusBadge`), 3 routes (`/alerts`, `/alerts/new`, `/alerts/[id]`), 25 unit tests (evaluator state machine, dispatcher HTTP classification, payload builder), 5 DB-level E2E tests (insert, cascade delete, version increment, optimistic concurrency, disabled filter). `serializeFilters` moved to `shared/utils/`. Build clean, TypeScript clean, 147 unit tests.

**Last completed side-track (2026-05-08): Component folder restructure**
All `features/*/components/` reorganized so every component lives in its own named subfolder — matching the `shared/components/` pattern. 118 files moved via `git mv`. Semantic group subfolders (`filters/`, `detail/`, `widgets/`, etc.) kept; flat `parts/` at feature-components root dissolved (shared-within-feature components promoted to own folders; single-parent sub-components nested inside parent's `parts/`). All imports updated, TypeScript clean. Rules updated: `PROJECT.md §2.2`, `§3.3`, `§15`. Two pre-existing TS errors also fixed: `e2e/ingest.spec.ts` (`body` → `data` for Playwright), `getOrgBySlug` explicit return type (`Promise<Org | null>`).

**Feature 05 — Dashboard** · `docs/features/05-dashboard.md`
Status: ✅ Done · 24 / 24 items

**Done:** `aggregation-utils.ts` (`pickBucket` + `resolveRange`, pure helpers extracted for testability), `aggregations.service.ts` (5 raw-SQL queries: `eventsPerMinute` w/ `date_trunc` + stacked by level, `levelBreakdown`, `environmentBreakdown` (null→`(unset)`), `topMessages` (200-char truncation), `recentErrors`, `hasAnyEvents`), extended `TimeRangePreset` to include `"30d"` + updated `parse-filters.ts` + `events-query.service.ts` + `TimeRangePicker` (`presets` prop), `dashboard.*` i18n namespace, `use-dashboard-range.ts` hook (URL state, independent from events page per Q-E3), `WidgetCard` + `WidgetEmpty` + SCSS, `EmptyProjectState` (curl example with API key prefix), 5 widget components: `EventsPerMinuteWidget` (stacked AreaChart), `LevelBreakdownWidget` (donut PieChart, click → events), `EnvironmentBreakdownWidget` (horizontal BarChart, click → events), `TopMessagesWidget` (table, click → events), `RecentErrorsWidget` (list, click → events drawer), `DashboardHeader` (project name + TimeRangePicker w/ 30d + AutoRefreshControl), `DashboardPage` (client composition, `useAutoRefresh` wired), `app/[org]/[project]/page.tsx` replaced placeholder with full SSR: guards empty projects, runs 5 queries in `Promise.all`, passes data to `DashboardPage`, 122 total unit tests (14 new), `e2e/dashboard.spec.ts` (8 tests — DB-level assertions + graceful browser skip), build clean, TypeScript clean.

**Previously done (Feature 04):** `UserPreferences` type + `autoRefresh` field, `user.ts` Redux slice with selectors, `OrgHydrator` updated, `update-preferences.action.ts` widened for autoRefresh, `events.*` i18n namespace, `EventFilters` type + `parse-filters.ts` + `serialize-filters.ts` + `parse-cursor.ts` (20 unit tests), `events-query.service.ts` (listEvents w/ dynamic Drizzle query, cursor pagination, defense-in-depth project soft-delete guard, FTS via websearch_to_tsquery, jsonb attribute filter; getEventById), `app/[org]/[project]/events/page.tsx` (SSR, searchParams → filters → query), `EventsPage.tsx` (client composition), `useEventFilters` hook (URL sync, cursor reset on filter change), `EventsFilterBar` + all filter components (LevelFilter, StringListFilter, CorrelationFilter, AttributeFilter, MessageFilter, TimeRangePicker, AddFilterDropdown, FilterChips), `EventsTable` + `EventTimestamp` (Intl + Tooltip), `PaginationControls` (cursor-based Newer/Older), `EventDrawer` + `EventDetailHeader` + `EventDetailTabs` + `AttributesList` (hover "Filter by") + `ContextTree` (JsonTree) + `StackTraceViewer` + `StackFrame`, `stack-trace-parser.ts` (V8/Python/Java, 6 unit tests), `AutoRefreshControl` + `useAutoRefresh` (visibility-aware, pause on hidden tab), `e2e/events.spec.ts` (7/8 passing — browser test skipped gracefully without active auth session), 108 total unit tests, build clean. DB singleton fix: `core/db/client.ts` now uses global singleton + pool limit (max:10) to prevent connection exhaustion under Next.js hot reload.

**Previously done (Feature 03):** Custom Postgres Docker image with pg_partman 5.4.3, `events` partitioned table (daily, 30d retention, 8 partitions premade), migration 0003 hand-edited for partman setup, Drizzle schema + 5 indexes (composite + GIN), `event-schema.ts` (Zod, single + batch), `sanitize-timestamp.ts`, `enrich-event.ts`, `rate-limit.service.ts` (RollingWindowLimiter, lazy cleanup, configurable via `RATE_LIMIT_PER_MIN`), `api-key-auth.service.ts` (Bearer token, debounced last_used_at), `ingest.service.ts`, route handlers (`POST /api/ingest`, `POST /api/ingest/batch`, OPTIONS CORS), `partman-maintenance.job.ts` (pg-boss hourly schedule, singletonKey), `core/worker/worker.ts`, `instrumentation.ts` (`WORKER_IN_PROCESS=true`), README.md with curl examples + field reference, E2E spec `ingest.spec.ts`, 28 new unit tests (82 total), build clean.

**Previously done (Feature 02):** Drizzle schema (projects, api_keys), slugify utils + key-generator + key-hash (18 unit tests), projects.service + api-keys.service, Redux project slice, 5 server actions, all components, all app routes, E2E specs (projects.spec.ts, api-keys.spec.ts), full live check passed.

**Previously done (Feature 01):** full auth, orgs, invitations, member management, roles CRUD, account pages, org settings, full App Shell, unit tests (36/36), E2E spec files, full 10-step live check passed.

---

## Roadmap

Each feature has its own implementation doc with a status block, decisions, schema, server actions, components, routes, and a step-by-step checklist.

| # | Feature | Status | Doc |
|---|---|---|---|
| — | Design System + UI kit v0.1 (side track) | ✅ Done | [features/design-system.md](features/design-system.md) |
| — | Design System v0.3.0 Update (side track) | 🟨 In progress | [features/ds-v03-update.md](features/ds-v03-update.md) |
| 00 | Foundation | ✅ Done | [features/00-foundation.md](features/00-foundation.md) |
| 01 | Auth + Organizations + Roles | ✅ Done | [features/01-auth-organizations-roles.md](features/01-auth-organizations-roles.md) |
| 02 | Projects + API keys | ✅ Done | [features/02-projects-api-keys.md](features/02-projects-api-keys.md) |
| 03 | Ingest | ✅ Done | [features/03-ingest.md](features/03-ingest.md) |
| 04 | Events list + filters + detail | ✅ Done | [features/04-events-list-filters.md](features/04-events-list-filters.md) |
| 05 | Dashboard | ✅ Done | [features/05-dashboard.md](features/05-dashboard.md) |
| 06 | Alerts | ✅ Done | [features/06-alerts.md](features/06-alerts.md) |
| 07 | Polish | ✅ Done | [features/07-polish.md](features/07-polish.md) |
| 08 | Docker packaging | 🟦 Planned | [features/08-docker-packaging.md](features/08-docker-packaging.md) |

Status legend:
- ⬜ Not started — no work yet
- 🟦 Planned — feature doc detailed, ready to implement
- 🟨 In progress — work started, see checklist
- ✅ Done — all checklist items complete, live check passed

"Planning pending" means the feature doc is a stub. We detail it when we reach it (or earlier if dependencies require).

---

## How to Resume After a Break

1. Read this file (PROGRESS.md) → identify current phase.
2. Open the linked feature doc.
3. Read its **Status**, **Locked decisions**, and **Implementation Checklist** sections.
4. Find the first unchecked item.
5. Continue.

If the feature doc says "planning pending" — stop and ask the user to detail the feature before implementation.

---

## Conventions

- **Doc updates**: when a feature is touched, update its status block (`Last touched`, `Progress: X/Y`). Update PROGRESS.md row.
- **Decisions made mid-implementation**: log them in the feature doc's "Decision log (local)" section. If the decision affects more than one feature → also append to PLAN.md §17.
- **New permission added**: register in `shared/permissions/registry.ts` AND list in PLAN.md §5 AND mention in the feature doc that introduced it.
- **New env variable**: add to `.env.example` AND the feature doc.
