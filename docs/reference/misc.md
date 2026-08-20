# Testing, Deployment & Other Aspects

## Testing

- **Unit/service tests**: Vitest (`vitest.config.ts` — jsdom environment, `@` alias to repo root, excludes `e2e/**` and `.next-e2e/**`). **50 test files / 501 tests**, `npm run test`. All are for **services/utils/Server Action logic** — there are currently **no `*.test.tsx` component tests** despite `@testing-library/react` and `jest-dom` being installed. Coverage concentrates on the security/data-integrity-critical modules: `features/ingest` (6 files: API key auth, rate limiting, attribute-type registry, event schema, timestamp sanitization), `features/alerts` (evaluator, dispatcher, **CRUD/version/state-transition logic in `alert-rules.service.test.ts`**, and the SSRF URL guard in `webhook-url.test.ts`), **`features/auth` (all 9 Server Actions, added 2026-08-13)**, plus `shared/permissions/check.test.ts`.

  **`features/overview/` got its first tests on 2026-08-20** (`PLAN.md` §16.1 Stage B): 50 tests over `utils/overview-filters.ts`, `utils/build-project-rows.ts` and `utils/bucket-totals.ts`, all three extracted from `app/[org]/(org-shell)/page.tsx` and `OverviewPage.tsx` in the same change. `overview.service.ts` itself — five raw-SQL aggregations — is covered by the integration suite below, not here: the query-builder mocking pattern cannot reach raw `db.execute`.

  **A test file can lie about what it covers.** `features/dashboard/services/aggregations.service.test.ts` never imported `aggregations.service.ts`; it tested `features/dashboard/utils/aggregation-utils.ts` under a name that made the 9.5 kB SQL service look covered and left the utils file with no visible neighbour. Renamed to `features/dashboard/utils/aggregation-utils.test.ts` on 2026-08-20 — no code change, but `aggregations.service.ts` now shows as the uncovered file it always was. Colocation only makes a gap visible if the file name tracks the module actually under test.

  **The db-mocking pattern does not cover the aggregation services.** All nine db-mocking tests stub the Drizzle *query builder* (`db.select().from().where()`). `overview.service.ts` and `aggregations.service.ts` use `db.execute(sql\`…\`)` with hand-written SQL instead, and stubbing `execute` to assert on the generated SQL text would test the string, not the result — it breaks on reformatting and passes on a semantically wrong query. That is what the integration tests below exist for. `aggregations.service.ts` is still uncovered.

- **Integration tests** (added 2026-08-20): Vitest against a **real Postgres**, `npm run test:it` (`vitest.integration.config.ts`, node environment). **3 files / 70 tests**: `overview.service.itest.ts`, `environment-registry.service.itest.ts` and `event-rollup.service.itest.ts`.

  - **`*.itest.ts`, beside the source, same as unit tests.** The distinct suffix is what keeps them out of `npm run test`: `vitest.config.ts` excludes `**/*.itest.ts` explicitly, and the integration config is a separate file rather than a second project, so the default run has no way to select them even if a glob changes. `npm run test` must keep working with no Docker running.
  - **Its own database, `logger_itest`** — a third one, alongside `logger` (dev) and `logger_test` (e2e). Not shared with e2e because `resetDb()` does `DELETE FROM events`, which would destroy a seeded corpus on the next `npm run test:e2e`.
  - **Created in code, not by hand.** `itest/support/global-setup.ts` creates the database if absent, runs `CREATE EXTENSION IF NOT EXISTS pg_partman` **into that database** (the init SQL only runs against the container's default database), migrates with the programmatic migrator, and seeds. Verified from scratch: dropping `logger_itest` and re-running rebuilds everything and passes in ~1.2 s. This is a deliberate answer to how `logger_test` went — manual creation, a missed extension, and a migrator that failed silently.
  - **The corpus is enumerated, not generated** (`itest/support/fixture.ts`). Every row carries a `why`, and every expected number in a test is a literal with its arithmetic in a comment. A randomised corpus would force each test to compute its expectation, and the only way to compute it is to re-implement the query — see the `build-payload.test.ts` failure above for where that ends up. Volume is a *different* corpus: nothing here reproduces a slow query, and `PLAN.md` §16.1 Stage C needs the opposite properties.
  - **Timestamps are anchored, and the anchor is stored in the data.** Two queries measure against `NOW()`, so absolute dates would drift out of range overnight. The seed runs in vitest's main process and tests run in workers, so the anchor travels as a marker event (`ANCHOR_MARKER`) that tests read back — which also means they assert against the timestamps actually inserted.
  - **Rows are inserted with direct SQL, not through the ingest API** — the opposite of the rule that got `scripts/seed-events.mjs` deleted, and deliberately so. That script impersonated real traffic while bypassing the checks real traffic must pass. Here, control over the exact row shape *is* the subject: `NULL` in columns the API would fill, and timestamps 40 days old that the API rejects.
  - The suite is read-only, so files share one seeding and can run in parallel. A test that ever needs to write must create its own project rather than mutate the fixture.

  The `features/auth` suite deliberately pins the security properties rather than the mechanics: no user-enumeration signal (login and password-reset return identical results for known and unknown accounts), the `revokeOtherSessions` call being separate from `changePassword` (regression guard for cf57619), the `pg_advisory_xact_lock` being taken before the `COUNT(users)` check in setup, passwords never appearing unhashed in an insert, and `updatePreferences` writing `preferences || patch::jsonb` rather than replacing the column — that last one was verified to fail against a deliberately broken replace-implementation before being kept. Db-touching services are unit-tested by mocking `@/core/db/client` with a small chainable stub (`db.select().from().where()...` returns a `.then`-able) and keeping the real `@/core/db/schema` import — see `alert-rules.service.test.ts` for the pattern.

  **`vitest.config.ts` sets `test.env`** with throwaway `DATABASE_URL` / `AUTH_SECRET` / `APP_URL` values. This is required, not cosmetic: `@/core/env` validates the entire server schema the moment it is imported, so any module under test that transitively reaches it (e.g. `rate-limit.service.ts`, `core/logger.ts`) fails to load without them. Nothing here connects to a real database. See also the `isServer` override in [stack.md](stack.md#environment-variables) — the companion half of making `@/core/env` importable under jsdom.

  Two mocking notes that bite when adding tests near these modules:
  - Mock at the **real** boundary. The webhook SSRF guard resolves DNS, so `alert-dispatcher.service.test.ts` mocks `node:dns/promises` — not the guard module itself, which is internal (per `.claude/rules/PROJECT.md` §11.1). Vitest needs a `default` export in that mock factory alongside the named `lookup`.
  - A hand-written `vi.mock("@/core/env", ...)` factory must include **every** key its importers read. `invite-member.test.ts` supplies `LOG_LEVEL` purely because the action transitively pulls in the pino singleton, which throws on an undefined level.

- **Benchmarks** (added 2026-08-20, `PLAN.md` §16.1 Stage C): `npm run bench` (`vitest.bench.config.ts`, `*.bench.ts`). One file today, `features/overview/services/overview.service.bench.ts`, measuring the five org-overview aggregations individually plus the whole page fan-out.

  - **Not pinned to a database.** `DATABASE_URL` comes from the environment, so the same file measures a local corpus or the staging server over an SSH tunnel:
    ```bash
    ssh -N -L 5433:localhost:5432 user@host
    DATABASE_URL=postgresql://logger:…@localhost:5433/logger npm run bench
    ```
  - **It calls the real service functions**, not copies of their SQL. A benchmark with its own copy of a query measures a query nobody runs.
  - **Targets are discovered at run time** (`bench/support/target.ts`): the organization with the most events, its projects, and a 24-hour range anchored on the **newest event** rather than on `now()` — anchoring on the clock would measure an empty range against a corpus that stopped growing and report it as fast. Every run prints the corpus it chose.
  - **The first benchmark is the round-trip floor** (`SELECT 1`). Measurements are client-side wall clock and include one network round trip; locally that is ~0.26 ms and ignorable, over a tunnel it is tens of milliseconds and dominates anything short. Read every other number net of it.
  - **`npm run bench:seed`** builds `logger_bench` — a fourth database, seeded once and reused, unlike `logger_itest` which is rebuilt every run. Messages come from `scripts/event-factory.mjs` so cardinality is realistic; the run prints the **distinct-message count**, which is what actually decides the cost of the top-messages aggregate. The corpus stays inside the last 3 days by default because pg_partman premakes 7 days either side and anything outside that lands in `events_default`, where it neither prunes nor parallelises like real data.
  - **Baselines** live in `bench/baselines/<date>-<host>-<size>.json` (`--outputJson`), committed, so a later run has something to be compared against.
  - **It builds the rollup before measuring**, using the real service — otherwise `rolled_up_to` would be NULL, every read would fall back to `events`, and the numbers would describe the code as it stood before `event_rollup_minutes` existed.
  - **It then pushes the rollup boundary back** (`BENCH_TAIL_MINUTES`, default 2, matching `OVERLAP_MINUTES`). Without that the build finishes *after* the newest event in the corpus, the raw tail is empty, and the union measures as free because there is nothing in it — which is exactly what the first run reported. Widening it is how the tail was shown to cost ~0.3–0.6 µs per event it contains.

  ⚠️ **Absolute numbers are not portable between machines.** The first local baseline put the whole page fan-out at ~106 ms on 500k events, against 1.4–1.6 s measured on the 2-vCPU staging droplet at 540k. Same code, ~13× apart. Use a baseline only against another run on the same host.

- **E2E tests**: Playwright (`playwright.config.ts`), 12 spec files in `e2e/`: `alerts`, `api-keys`, `auth`, `auth-bootstrap`, `dashboard`, `events`, `ingest`, `invite`, `overview`, `projects`, `role-management`, `theme` — 73 tests total, run with `npm run test:e2e`.

  **`overview.spec.ts` (added 2026-08-20)** is the only spec that asserts the org overview's *contents*. Before it, `login()` navigated there on every test in every spec and waited for the URL, so the page rendered constantly and was verified never — a version showing all zeros would have passed the whole suite. It found a real ordering bug on its first run (see [logging.md](logging.md#ordering-count-columns-are-cast-to-text)). Its seed uses counts of **10 and 9 on purpose**: any pair of single-digit counts sorts the same lexicographically as numerically and hides that class of bug entirely.

  Assertions there go through `getByRole("group", { name })`, which required adding `role="group"` + `aria-label` to the overview's KPI and widget cards — they were unlabelled `div`s with only CSS-module classes to identify them, and `PROJECT.md` §11 forbids querying by class. Scoping matters in both directions: the sidebar links to every project by the same name the project cards use, so an unscoped `getByRole("link", { name: /Project/ })` matches twice. As of 2026-08-13, every spec logs in and exercises the real UI/API rather than asserting against seeded rows directly (the one exception — `ingest.spec.ts` — is intentionally API-only, since it's testing the ingest HTTP endpoint itself, not a page).

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

`npm run test:it` is **not** in CI either, and unlike e2e it is close to being addable: it needs no app instance, creates and seeds its own database, and finishes in about a second. The blocker is `pg_partman` — migration 0003 calls `create_parent()`, and the stock `postgres:16` image a GitHub Actions `services:` block would give you does not have the extension. Making it work means building `db/Dockerfile` in the workflow, or publishing that image, neither of which can be verified outside CI. Until then the integration suite is a local gate: **run it for any change to a service that issues raw SQL.**

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

## Scripts that feed a running instance

Three scripts push events into a **running** install through the real ingest HTTP API. None of them touches the database directly — that is deliberate, because writing rows behind the API would exercise none of auth, rate limiting, validation or the attribute type registry. All three read `LOGGER_URL` and `LOGGER_API_KEY` from the environment; the key is never committed, since this repository is public.

| Script | Shape | Use it when |
|---|---|---|
| `demo-live.mjs` (`npm run demo`) | bursts of 1–3 events every 0.6–1.8 s (~150/min), colourised per-event output | showing the product to a person |
| `event-one-by-key.mjs` | one request per event, rate oscillating over a configurable envelope (default 300–500/min) | watching the dashboard move — the shape of the curve is the point |
| `events-batch-by-key.mjs` | batches of up to 500 per request, paced to a target rate, with a total cap | filling a database with volume |

`event-one-by-key.mjs` and `events-batch-by-key.mjs` share `scripts/event-factory.mjs`, which builds the event objects and parses `Retry-After`. Two things in it are deliberate and easy to break:

- **Randomising an event preserves the type of every attribute.** The project's [attribute type registry](logging.md#attribute-type-enforcement) rejects a key whose type changes, so sending `latency_ms` as a number and later as a string kills a long run with a 400 partway through.
- **Messages are drawn from templates spanning three cardinality classes** — some verbatim repeats, some with a bounded token, some effectively unique per event (roughly 48% distinct in practice). This is about measurement, not realism: the dashboard's "Top messages" widget runs `GROUP BY SUBSTRING(message, 1, 200)`, and that hash aggregate's cost scales with the number of **distinct** messages, not rows. An earlier version used twelve fixed strings, and an `EXPLAIN ANALYZE` over 195k events duly reported 275 groups in 77 kB — a number that told us nothing about production. Anyone editing the templates should keep the spread.

Measured against a real deployment on 2026-08-19: a single-event request costs ~70 ms, a 500-event batch ~516 ms — roughly 1 ms per event, so batching is about seventy times cheaper per event. Rate limiting is per API key and batch requests consume one unit **per event**, not per request, which is what caps both scripts.

> **Removed 2026-08-19: `scripts/seed-events.mjs`.** It wrote to Postgres directly, resolved its target project by a slug hardcoded to `"some"` while its own error message said `"test"`, and had been listed as a defect in [`PROGRESS.md`](../PROGRESS.md) rather than fixed. The three API-based scripts above cover everything it was used for, and they exercise the real ingest path while doing it.
