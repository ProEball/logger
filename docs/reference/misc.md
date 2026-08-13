# Testing, Deployment & Other Aspects

## Testing

- **Unit/service tests**: Vitest (`vitest.config.ts` — jsdom environment, `@` alias to repo root, excludes `e2e/**` and `.next-e2e/**`). 22 test files, `npm run test`. All are for **services/utils/business logic** — there are currently **no `*.test.tsx` component tests** despite `@testing-library/react` and `jest-dom` being installed. Coverage concentrates on the security/data-integrity-critical modules: `features/ingest` (6 files: API key auth, rate limiting, attribute-type registry, event schema, timestamp sanitization) and `features/alerts` (evaluator, dispatcher, **and CRUD/version/state-transition logic in `alert-rules.service.test.ts`**), plus `shared/permissions/check.test.ts`. Db-touching services are unit-tested by mocking `@/core/db/client` with a small chainable stub (`db.select().from().where()...` returns a `.then`-able) and keeping the real `@/core/db/schema` import — see `alert-rules.service.test.ts` for the pattern.

- **E2E tests**: Playwright (`playwright.config.ts`), 11 spec files in `e2e/`: `alerts`, `api-keys`, `auth`, `auth-bootstrap`, `dashboard`, `events`, `ingest`, `invite`, `projects`, `role-management`, `theme` — 53 tests total, run with `npm run test:e2e`. As of 2026-08-13, every spec logs in and exercises the real UI/API rather than asserting against seeded rows directly (the one exception — `ingest.spec.ts` — is intentionally API-only, since it's testing the ingest HTTP endpoint itself, not a page).

  **Isolated e2e environment** — e2e runs against its own database and app instance, never the shared dev database:
  - A separate Postgres database, `logger_test` (same Postgres instance/container as dev, different DB name), created once manually (`CREATE DATABASE logger_test;`) with the `pg_partman` extension enabled on it separately (`db/init/01-extensions.sql` only runs against the *default* `POSTGRES_DB` on first container init, not on a manually-created second database).
  - `.env.e2e.local` (gitignored, same shape as `.env.local`) points `DATABASE_URL` at `logger_test` and sets a dedicated `APP_URL`/`AUTH_SECRET`.
  - `npm run db:migrate:e2e` (`scripts/migrate-e2e.mjs`) applies migrations to it — via the programmatic `drizzle-orm/postgres-js/migrator`, **not** the `drizzle-kit migrate` CLI, because that CLI silently swallows errors behind its progress spinner in this environment (confirmed cause: it fails outright, with no visible error, against a fresh DB missing `pg_partman` — `CREATE EXTENSION pg_partman;` on `logger_test` first, then re-run).
  - `playwright.config.ts`'s `webServer` starts a **second** `next dev` instance on port **3100** (not the usual port 80) against `logger_test`, with `E2E_MODE=true` set (see [stack.md](stack.md#environment-variables)) — this is a fully separate app process from whatever dev server you may have running on port 80, so both can run at once without interfering with each other's data.
  - Every spec file that needs a clean slate calls `resetDb()` (`e2e/support/cleanup.ts`) in `beforeAll` — a full-table wipe in FK-safe order. This is only safe because the suite owns `logger_test` exclusively; it would be destructive against the dev database (an earlier iteration of this suite did wipe the shared dev DB this way before the isolated setup existed).
  - Because several spec files do this full-DB reset, `playwright.config.ts` sets `workers: 1` — spec files must run strictly sequentially, not in parallel, or they'd wipe each other's fixtures mid-run.
  - Shared helpers live in `e2e/support/`: `db.ts` (`withDb()` — connect/query/close boilerplate), `auth.ts` (`bootstrapOrg()`, `login()`, `inviteMember()`, `acceptInvite()` — drive the real forms), `cleanup.ts` (`resetDb()`), `ui.ts` (`labelFor()` — see below), `env.ts`, `api-keys.ts`, `invitations.ts`.

  **Playwright/app interaction gotchas worth knowing before touching e2e specs:**
  - `shared/components/Checkbox` and `Switch` render a decorative `<span>` on top of the native `<input>`; clicking the input directly — even with `{force: true}` — can silently land on the wrong element. Click the wrapping `<label>` instead (`labelFor(page, control)` in `e2e/support/ui.ts`).
  - `page.waitForLoadState("networkidle")` is **not reliable** for detecting when a Next.js Server Action has actually finished (observed cases where a button still showed a pending state and the DB write hadn't landed, well after `networkidle` resolved) — wait for an explicit signal instead: visible text (a toast, a redirect) or `expect.poll(...)` against the database directly.

- Project convention (`.claude/rules/PROJECT.md`): unit/integration tests live next to the source file (`ComponentName.test.tsx`), test behavior via role/label queries not implementation details, and mock only at system boundaries.

## Deployment

**Current actual state as of 2026-08-12: production Docker packaging is planned but not yet built.**

What exists today:
- `db/Dockerfile` — `postgres:16` + `postgresql-16-partman` apt package. This is the **only** Dockerfile in the repo.
- `docker-compose.dev.yml` — builds the Postgres image above, mounts `db/init/01-extensions.sql` (creates the `pg_partman` extension) and a data volume. **No app or worker service is defined** — you run those with `npm run dev`/`npm run start` directly.
- No root-level application `Dockerfile`, no production `docker-compose.yml`, no `Caddyfile`, no backup scripts.

The **planned** architecture (`docs/features/08-docker-packaging.md`, 0/30 checklist items done as of this writing) describes: a 3-stage app Dockerfile (`deps → builder → runner`, Next.js `output: "standalone"` — not currently set in `next.config.ts`), a separate **worker container** (same image, different entrypoint, pinned to `replicas: 1` as a backstop for pg-boss singleton cron jobs), a **Caddy** reverse proxy with automatic HTTPS, a one-shot **migrate** init container gating app/worker startup (`depends_on: service_completed_successfully`), and a nightly `pg_dump` + offsite-backup container. Treat this section of the planning doc as a roadmap, not current state.

What actually works today for running the app "in production mode":
- `npm run build && npm run start` — runs on **port 80** directly (both `dev` and `start` scripts use `-p 80`, not the Next.js default 3000 — relevant if/when the planned Caddy config is written, since a naive `reverse_proxy app:3000` would be wrong).
- **Worker toggle**: set `WORKER_IN_PROCESS=true` to run the pg-boss worker (partition maintenance + alert evaluation/delivery) inside the same Next.js process, via `instrumentation.ts`'s `register()` hook. This is a stopgap for single-instance deployments — it is **not** the intended production topology (a dedicated worker container is planned; running in-process on every replica of a horizontally-scaled app risks duplicate cron execution beyond what `singletonKey` alone guards against).
- **Migrations**: `npm run db:migrate` (`drizzle-kit migrate`), or `scripts/apply-migrations.mjs` (an ad hoc script). No init-container wiring exists yet — migrations must be applied manually before/during a deploy.
- **Health checks**: `GET /api/health` (liveness) and `GET /api/health/ready` (readiness — checks DB, pg-boss, ingest freshness, migration status; see [api.md](api.md#operational-endpoints)) are both fully implemented today, ahead of the rest of the Docker packaging work. Use `/api/health/ready` as your container orchestrator's readiness probe.
- **CI build metadata**: set `NEXT_PUBLIC_BUILD_SHA` and `NEXT_PUBLIC_BUILD_TIME` at build time so `/api/version` reports something meaningful:
  ```bash
  NEXT_PUBLIC_BUILD_SHA=$(git rev-parse --short HEAD) \
  NEXT_PUBLIC_BUILD_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ) \
  npm run build
  ```

## App logger

There are currently **three** logger definitions in the codebase, which is worth knowing so you don't accidentally use the wrong (dead) one:

| File | Status | Behavior |
|---|---|---|
| `core/logger.ts` | **Active** — this is what `@/core/logger` actually resolves to (a sibling `.ts` file wins over a same-named directory's `index.ts` in module resolution) | `pino({ level: process.env.LOG_LEVEL ?? "info" })`, plain JSON output always, level configurable via `LOG_LEVEL` |
| `core/logger/index.ts` | **Orphaned dead code** — unreachable due to the resolution rule above | `pino({ level: "info" })`, hardcoded level, no env override |
| `shared/services/logger.ts` | **Unused dead code** — zero importers anywhere in the app | Uses `pino-pretty` in non-production for colorized dev output, plain JSON in production |

Every real consumer (`core/auth/config.ts`, `core/db/middleware/slow-query-logger.ts`, `features/ingest/jobs/partman-maintenance.job.ts`, etc.) imports from `core/logger.ts`. This app logger is entirely separate from the product's own event-ingestion feature — `core/logger` writes structured JSON to the process's stdout for operators; `features/ingest` persists *customer-submitted* log events into Postgres. Don't confuse "the app's own logs" with "the logs this product stores for its users."

## Internationalization

`core/i18n/` — a typed dictionary lookup, **English-only today** (no other locale exists). `t(key)` walks a dot-separated key path into a large nested `as const` dictionary object (`dictionary.ts`) and, if a key is missing, **returns the key itself rather than throwing** — a deliberate fail-soft choice so a missing translation degrades to a visible-but-ugly string instead of crashing a page.

## Theming

`core/theme/` — supports `dark` / `light` / `system`, default `dark` (also the default in the `users.preferences` jsonb column). Resolved via a client `ThemeProvider` that listens to `matchMedia` for `system` mode changes, persists the chosen theme in a cookie (`logger_theme`), and applies a `data-theme` attribute to `<html>`. An inline no-flash script in the root layout applies the cookie value before first paint to avoid a flash of the wrong theme.

Two persistence layers, resolved with the DB value taking priority (`app/[org]/(org-shell)/layout.tsx`: `theme = preferences.theme ?? cookieTheme`): the `logger_theme` cookie (per-browser, set client-side, used for the pre-hydration no-flash paint) and `users.preferences.theme` (per-account, so the choice follows the user to a fresh browser/session). `shared/components/AppShell/parts/ThemeSwitcher.tsx` writes both — Redux dispatch (drives the cookie via `ThemeProvider`'s effect) and `updatePreferencesAction` (DB) — and **awaits** the DB write rather than firing it and forgetting it, specifically so the save isn't silently dropped if the tab closes right after switching themes (fixed 2026-08-13; was `void updatePreferencesAction(...)`).

## Global state (Redux)

`core/store/` — four slices: `theme`, `org` (current organization), `project` (current project), `user`. Server-fetched org/project data is pushed into Redux client-side via `OrgHydrator`/`ProjectHydrator` components rather than being fetched client-side — Redux here is a client-side cache/mirror of server state, not the primary data source.

## Query performance monitoring

Every database query issued through the app's Drizzle instance is timed by a `Proxy`-based middleware (`core/db/middleware/slow-query-logger.ts`); any query taking ≥500ms is logged at `WARN` with its SQL text (reconstructed with `?` placeholders), duration, and parameter count. This is a blanket, always-on instrument — no per-query opt-in/out.

## Demo / seed script

`scripts/demo-live.mjs` (`npm run demo`) — seeds a **running instance** with sample events via the real ingest API (not a DB seed script), using `LOGGER_URL`/`LOGGER_API_KEY` env vars. Useful for populating a fresh environment to explore the dashboard/events UI without wiring up a real event source.
