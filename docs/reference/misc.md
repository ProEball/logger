# Testing, Deployment & Other Aspects

## Testing

- **Unit/service tests**: Vitest (`vitest.config.ts` — jsdom environment, `@` alias to repo root, excludes `e2e/**` and `.next-e2e/**`). **32 test files / 293 tests**, `npm run test`. All are for **services/utils/Server Action logic** — there are currently **no `*.test.tsx` component tests** despite `@testing-library/react` and `jest-dom` being installed. Coverage concentrates on the security/data-integrity-critical modules: `features/ingest` (6 files: API key auth, rate limiting, attribute-type registry, event schema, timestamp sanitization), `features/alerts` (evaluator, dispatcher, **CRUD/version/state-transition logic in `alert-rules.service.test.ts`**, and the SSRF URL guard in `webhook-url.test.ts`), **`features/auth` (all 9 Server Actions, added 2026-08-13)**, plus `shared/permissions/check.test.ts`. `features/overview/` remains the one feature with no tests at all.

  The `features/auth` suite deliberately pins the security properties rather than the mechanics: no user-enumeration signal (login and password-reset return identical results for known and unknown accounts), the `revokeOtherSessions` call being separate from `changePassword` (regression guard for cf57619), the `pg_advisory_xact_lock` being taken before the `COUNT(users)` check in setup, passwords never appearing unhashed in an insert, and `updatePreferences` writing `preferences || patch::jsonb` rather than replacing the column — that last one was verified to fail against a deliberately broken replace-implementation before being kept. Db-touching services are unit-tested by mocking `@/core/db/client` with a small chainable stub (`db.select().from().where()...` returns a `.then`-able) and keeping the real `@/core/db/schema` import — see `alert-rules.service.test.ts` for the pattern.

  **`vitest.config.ts` sets `test.env`** with throwaway `DATABASE_URL` / `AUTH_SECRET` / `APP_URL` values. This is required, not cosmetic: `@/core/env` validates the entire server schema the moment it is imported, so any module under test that transitively reaches it (e.g. `rate-limit.service.ts`, `core/logger.ts`) fails to load without them. Nothing here connects to a real database. See also the `isServer` override in [stack.md](stack.md#environment-variables) — the companion half of making `@/core/env` importable under jsdom.

  Two mocking notes that bite when adding tests near these modules:
  - Mock at the **real** boundary. The webhook SSRF guard resolves DNS, so `alert-dispatcher.service.test.ts` mocks `node:dns/promises` — not the guard module itself, which is internal (per `.claude/rules/PROJECT.md` §11.1). Vitest needs a `default` export in that mock factory alongside the named `lookup`.
  - A hand-written `vi.mock("@/core/env", ...)` factory must include **every** key its importers read. `invite-member.test.ts` supplies `LOG_LEVEL` purely because the action transitively pulls in the pino singleton, which throws on an undefined level.

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

## Continuous integration

Two workflows in `.github/`, both added 2026-08-13 (before that, nothing ran on push — every merge was verified by hand):

- **`ci.yml`** — runs on push to `main` and on every pull request. Job `gates` runs the four checks from `WORKFLOW.md` §3 in order (`tsc --noEmit`, `lint`, `test`, `build`), each with `if: always()` so one red gate does not hide the others. Job `image` builds the Docker image in parallel without pushing it, so a Dockerfile break is caught by CI rather than at deploy time. Both use Node 22, matching the image's base. `DATABASE_URL`/`AUTH_SECRET` are set to throwaway values because `npm run build` imports `core/env`, which validates the whole schema on import; no database is contacted.
- **`release.yml`** — runs on a `v*` tag. Builds and pushes to `ghcr.io/<owner>/logger` tagged with the exact version, the `major.minor` line, the commit SHA, and `latest` (skipped for pre-release tags containing `-`). Passes `NEXT_PUBLIC_BUILD_SHA`/`NEXT_PUBLIC_BUILD_TIME` as build args, which is the only point at which they can be set.

`npm run test:e2e` is **not** in CI — it needs the isolated `logger_test` database and a running app instance (see [Testing](#testing) above). Run it locally for changes touching routing, auth or a user flow.

## Deployment

**Implemented and live-checked 2026-08-13** (Feature 08). Operational procedures — first deploy, updates, backup/restore, certificate troubleshooting — live in [`docs/OPERATIONS.md`](../OPERATIONS.md); this section is the reference for *what exists*.

### Artifacts

| File | Role |
|---|---|
| `Dockerfile` | 3-stage app image: `deps` (`npm ci`) → `builder` (`npm run build`) → `runner` (`node:22-alpine`, non-root `node` user) |
| `.dockerignore` | Excludes `node_modules`, build output, tests, secrets, `.github`, docs — **except `docs/reference`**, which the help centre reads at runtime |
| `docker-compose.yml` | Production stack, `name: logger-prod` |
| `docker-compose.dev.yml` | Postgres only, default project name (`logger`) |
| `Caddyfile` | Reverse proxy, `{$DOMAIN}` placeholder, `reverse_proxy app:3000` |
| `db/Dockerfile` | `postgres:16` + `postgresql-16-partman` |
| `db/backup.Dockerfile` | `postgres:16-alpine` + `rclone` — needs both `pg_dump` and `rclone` in one image |
| `scripts/backup.sh` | `pg_dump -Fc` loop, rotation, optional `rclone copy` |
| `scripts/restore.sh` | Drop-and-recreate restore, with an archive-readability precheck |
| `scripts/build-worker.mjs` | esbuild bundling for the two non-Next entrypoints |
| `.env.production.example` | Annotated template for the production `.env` |

### Topology

Six services. `app`, `worker` and `migrate` are **the same image with different `command:`s**, so all three necessarily run the same application code — a separately-built worker could drift a commit behind the app and evaluate alerts against a stale schema.

Boot order is enforced: `postgres` healthy → `migrate` exits 0 (`condition: service_completed_successfully`) → `app` and `worker` → `proxy` once `app` is healthy.

- **`output: "standalone"`** is set in `next.config.ts`. The runner copies `.next/standalone` (which carries its own pruned `node_modules`), plus `.next/static` and `public`, which standalone does not include automatically.
- **`outputFileTracingIncludes: { "/*": ["docs/reference/**/*.md"] }`** is also set, and is not optional. `features/help/services/help-content.service.ts` reads those eight files via `path.join(process.cwd(), "docs", "reference")` at runtime; Next's file tracer only follows static imports, so without the declaration the standalone output ships without them and every help page 500s in production while working perfectly in dev.
- **The app listens on 3000 inside the container**, not 80. It runs `.next/standalone/server.js`, which reads `PORT`/`HOSTNAME` from the environment (`ENV PORT=3000`, `HOSTNAME=0.0.0.0` in the Dockerfile). The `-p 80` in `npm run dev`/`npm run start` governs local development only — the container never runs `next start`. The Caddyfile, the compose healthcheck and `ENV PORT` must agree.
- **`NODE_ENV=production` is baked into the image**, not left to `env_file`. `next build` already hardcodes production behaviour into the app bundle, but `worker` and `migrate` are plain `node` processes with no framework to default it — unset, they silently take development branches, including the pooled-client global in `core/db/client.ts`.
- **Caddy adds no security headers.** The app emits the full set including a per-request nonce CSP; a browser enforces every CSP header it receives and the proxy cannot know the nonce, so any policy added there blocks the nonced inline scripts Next uses to boot the client. See [security.md](security.md#content-security-policy-nonce-based).
- **Image size ≈ 306 MB** (linux/amd64). The Node 22 binary alone is 123 MB; application content is ~56 MB (`.next` 18 MB, standalone `node_modules` 35 MB of which `@img`/`sharp` is 17 MB, worker + migrate bundles 2.5 MB). Feature 08's original `< 250 MB` target was set without measuring and is not reachable on `node:*-alpine`.

### The two non-Next entrypoints

`next build` only compiles what is reachable from `app/`, so the worker and the migration runner are bundled separately by `scripts/build-worker.mjs` (esbuild, CJS, `target: node22`, dependencies inlined, `@` alias mirroring tsconfig). `npm run build` runs both steps; `npm run build:worker` runs just the esbuild one. Output goes to `dist/` (gitignored, eslint-ignored).

- **`core/worker/main.ts` → `worker.js`.** Starts pg-boss via the shared `startWorker()`, starts the health-touch, installs SIGTERM/SIGINT handlers. Graceful shutdown drains in-flight jobs with a 20s cap, below the 30s compose `stop_grace_period`.
- **`core/db/migrate.ts` → `migrate.js`.** Uses drizzle-orm's programmatic migrator, **not** `drizzle-kit migrate`: the CLI would pull dev dependencies into the runtime image and reads `drizzle.config.ts`, which wants `dotenv` and a `.env.local` that does not exist in a container. Both write the same `drizzle.__drizzle_migrations` table, so they are interchangeable against an existing database. Migrations are copied to `/app/migrations` and located via `MIGRATIONS_DIR`.

Dependencies are inlined rather than left external on purpose. Relying on Next's file trace to have happened to include a worker-only dependency would fail at runtime, in production, with no build-time signal.

### Worker liveness

The worker exposes no HTTP. `core/worker/health-touch.ts` advances the mtime of `/tmp/worker-alive` every 30s from inside the Node process; the compose healthcheck asserts `find /tmp/worker-alive -mmin -1` matches. The touch lives in the worker process, never in a wrapper script — a shell loop would keep reporting healthy after Node had died. A failed touch is logged and swallowed, so a full `/tmp` degrades the health signal instead of killing a worker that is otherwise draining jobs.

### Still true of the running app

- **Every route is server-rendered on demand** — `next build` reports no `○ (Static)` routes at all. This is a consequence of the nonce-based CSP: the root layout reads `headers()` to get the per-request nonce, which opts the whole route tree into dynamic rendering (see [security.md](security.md#content-security-policy-nonce-based)). Any future CDN/edge-caching plan has to account for this; it is not an accident to be "optimized away" without also dropping the nonce.
- **`WORKER_IN_PROCESS=true`** still runs pg-boss inside the Next.js process via `instrumentation.ts`. It is a **dev convenience** — production uses the `worker` container, and both paths share `startWorker()` so a job registered once is picked up by both. Setting it true in production would give the alert evaluator a second scheduler racing the first.
- **Migrations** in development: `npm run db:migrate` (`drizzle-kit migrate`). In production the `migrate` container does it, gated by compose. `scripts/apply-migrations.mjs` is an ad hoc script that writes migration *names* where drizzle expects content *hashes* — it is not a supported path and should not be used against any database you care about.
- **Health checks**: `GET /api/health` (liveness) and `GET /api/health/ready` (readiness — DB, pg-boss, ingest freshness, migration status; see [api.md](api.md#operational-endpoints)). `/api/health/ready` is the compose readiness probe for `app`.
- **Build metadata**: `NEXT_PUBLIC_BUILD_SHA` / `NEXT_PUBLIC_BUILD_TIME` are inlined by `next build` and surface at `/api/version`. `release.yml` passes them as build args; a manual build can too:
  ```bash
  docker compose build \
    --build-arg NEXT_PUBLIC_BUILD_SHA=$(git rev-parse --short HEAD) \
    --build-arg NEXT_PUBLIC_BUILD_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  ```
  Setting them in `.env` after the fact has no effect.

## App logger

**`core/logger.ts` is the only logger.** `pino({ level: env.LOG_LEVEL })` — plain JSON to stdout, always, in every environment. It reads the **validated** env (since 2026-08-13), so an invalid level fails at boot rather than reaching pino.

Consumers: `core/auth/config.ts`, `core/db/middleware/slow-query-logger.ts`, `features/ingest/jobs/partman-maintenance.job.ts`. All import `@/core/logger`.

> Until 2026-08-13 there were **three** logger definitions — `core/logger/index.ts` (unreachable: a sibling `.ts` file wins over a same-named directory's `index.ts` in module resolution) and `shared/services/logger.ts` (zero importers). Both deleted.

### Why there is no `pino-pretty` in development

The deleted `shared/services/logger.ts` was the only place configuring a `pino-pretty` transport. Folding it into `core/logger.ts` gated on `NODE_ENV !== "production"` was tried and **deliberately rejected** — it works under `next dev`, but the risk/benefit is bad:

- `pino-pretty` is a **devDependency**, and feature 08's planned `deps` stage runs `npm ci --omit=dev` — so it will not exist in the runtime image.
- pino constructs its transport worker **eagerly**, at `pino()` call time. `proxy.ts` → `core/auth/config.ts` → the logger, so a construction failure is not a degraded log line; it is **every request failing at boot**.
- The gate is a single env var. `next start` sets `NODE_ENV=production` itself, but the **planned worker container runs plain `node dist/worker.js`**, where nothing sets it — and `.env.production.example` (feature 08 step 22) does not list `NODE_ENV`. That is a concrete path to a worker that crash-loops with an obscure worker-thread module-resolution error.

The upside — colorized output for an app that logs roughly three things (password-reset URLs, slow queries, partman job errors) — does not justify that. If pretty dev logging is ever wanted, do it safely: move `pino-pretty` to `dependencies`, or gate on a dedicated `LOG_PRETTY` env flag defaulting to `false`, rather than on `NODE_ENV`.

This app logger is entirely separate from the product's own event-ingestion feature — `core/logger` writes structured JSON to the process's stdout for operators; `features/ingest` persists *customer-submitted* log events into Postgres. Don't confuse "the app's own logs" with "the logs this product stores for its users."

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
