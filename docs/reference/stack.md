# Stack, Dependencies & Environment

## Runtime requirements

| Requirement | Version / detail |
|---|---|
| Node.js | `next` declares `engines.node >= 20.9.0`; `@types/node` targets `^20`. **Production runs Node 22** — the Docker image is `node:22-alpine` and CI pins Node 22 to match. Bump the Dockerfile, `ci.yml`, and the esbuild `target` in `scripts/build-worker.mjs` together |
| PostgreSQL | **16**, stock. `pg_partman` was required until 2026-08-26 and is not any more — it existed for the partitioned `events` table, which moved to ClickHouse. The custom `db/Dockerfile` that installed it is deleted and both compose files run the upstream `postgres:16` image |
| OS | Any (dev instructions assume Windows/PowerShell per this repo's environment, but the app itself is platform-agnostic) |
| Package manager | npm (`package-lock.json` present) |

**Two different ports, and the distinction matters.** Locally the app binds **port 80**: both `dev` and `start` use `-p 80`, not the Next.js default 3000. **In the container it binds 3000** — the image runs `.next/standalone/server.js`, which reads `PORT` from the environment (`ENV PORT=3000`), and never runs `next start`. Reverse-proxy config and healthchecks in the production stack therefore target 3000; see [misc.md#deployment](misc.md#deployment).

## Framework & language

- **Next.js 16.2.4** — App Router, TypeScript, no `src/` directory (routes live directly under `app/`).
- **React 19.2.4** / **react-dom 19.2.4**.
- **TypeScript 5**, `strict: true`.
- **ESLint 9** with `eslint-config-next`.
- Project convention: `AGENTS.md` at the repo root explicitly warns that this Next.js version has breaking changes vs. older training-data assumptions (e.g. `middleware.ts` is renamed to `proxy.ts` — see [architecture.md](architecture.md)) and to consult `node_modules/next/dist/docs/` before writing framework-adjacent code.

## Data layer

| Package | Role |
|---|---|
| `drizzle-orm` (`^0.45.2`) | ORM / type-safe query builder |
| `drizzle-kit` (`^0.31.10`, dev) | `export` (driven by `scripts/build-schema.mjs`) and `studio`. Its `generate` / `migrate` / `push` commands are deliberately unwired — see below |
| `@clickhouse/client` (`^1.23.1`) | ClickHouse HTTP client. There is no Drizzle dialect for ClickHouse, so the events path is raw SQL with `query_params` binding |
| `postgres` (`^3.4.9`) | Low-level Postgres driver (`postgres.js`), wrapped in a slow-query-logging proxy |
| `pg-boss` (`^12.18.2`) | Postgres-backed job queue/scheduler (cron jobs + on-demand work) — no Redis, no separate message broker |

**There are no migrations.** The sixteen-file chain in `core/db/migrations/` was deleted on 2026-08-26; see [architecture.md](architecture.md#schema-and-the-bootstrap) for the mechanism and `PLAN.md` §17 for the reasoning and the cost. Each store has one file describing its end state, applied whole and idempotently by `core/db/bootstrap.ts`:

| File | Store | Maintained by |
|---|---|---|
| `db/schema.sql` | Postgres | **Generated** — `npm run db:schema`. Runs `drizzle-kit export` over `core/db/schema/index.ts` and makes each statement idempotent. Never hand-edited. Entirely generated since 2026-08-26: `db/events.sql` and the splice that inserted it are gone with the Postgres `events` table |
| `core/clickhouse/schema.sql` | ClickHouse | Hand-written |

## Auth

- **better-auth** (`^1.6.9`) — email/password authentication, session management, password reset tokens. Only the `nextCookies()` plugin is enabled; **no** better-auth `organization` or `apiKey` plugin is used — organizations, roles, permissions, and API keys are entirely custom-built on top of Drizzle tables. See [users-roles.md](users-roles.md) and [security.md](security.md).

## State & forms

- **Redux Toolkit** (`@reduxjs/toolkit` `^2.11.2`, `react-redux` `^9.2.0`) — global app state: theme, current org, current project, current user. Feature-local state uses React Context or plain `useState`/`useReducer` (see `.claude/rules/PROJECT.md` conventions).
- **gform-react** (`^2.8.2`) — form library used for all forms per project convention.
- **Zod** (`^4.4.2`) — validation everywhere: ingest payloads, Server Action inputs, env vars.
- **@t3-oss/env-nextjs** (`^0.13.11`) — typed, validated environment variable access (wraps Zod).

## UI

- **SCSS Modules** (`sass` `^1.99.0`) — no Tailwind, no CSS-in-JS. Global styles only in `app/globals.scss`.
- **Recharts** (`^3.8.1`) — dashboard charts (stacked area, bar).
- **@floating-ui/react** (`^0.27.19`) — positioning for popovers/dropdowns/tooltips.
- A large internal component library lives in `shared/components/` (Button, Table, Modal, Drawer, Combobox, CommandPalette, JsonTree, Timeline, Toast, etc.) — see [architecture.md](architecture.md).

## Logging & observability (of the app itself)

- **pino** (`^10.3.1`) / **pino-pretty** (`^13.1.3`, dev) — structured app logger, distinct from the product's own event-ingestion feature. See [misc.md](misc.md#app-logger).

## Testing

| Package | Role |
|---|---|
| `vitest` (`^4.1.5`) | Unit/service test runner |
| `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event` | Component/DOM testing utilities (installed but currently only used indirectly — no `*.test.tsx` files exist yet, see [misc.md](misc.md#testing)) |
| `@playwright/test` (`^1.59.1`) | End-to-end tests |
| `jsdom` | Vitest DOM environment |

## Build tooling

- **esbuild** (`^0.28.2`, dev) — bundles the two Node entrypoints `next build` does not produce: `core/worker/main.ts` → `dist/worker.js` and `core/db/bootstrap.ts` → `dist/bootstrap.js`. A third, a one-shot template-hash backfill, was deleted on 2026-08-26 with the column it filled. Driven by `scripts/build-worker.mjs`; see [misc.md#deployment](misc.md#deployment). Not used for anything the browser loads — that is entirely Next's own (Turbopack) pipeline.

## npm scripts

```bash
npm run dev          # next dev -p 80
npm run build         # next build && node scripts/build-worker.mjs
npm run build:worker   # just the esbuild step — worker.js + bootstrap.js into dist/
npm run start         # next start -p 80  (local only; the container runs standalone server.js on 3000)
npm run lint           # eslint
npm run db:schema      # regenerates db/schema.sql from core/db/schema/*.ts
npm run db:bootstrap   # applies db/schema.sql and core/clickhouse/schema.sql to the dev stores
npm run db:studio      # drizzle-kit studio
npm run test            # vitest run — unit tests, jsdom, needs no database
npm run test:it          # vitest run --config vitest.integration.config.ts — needs Postgres AND ClickHouse
npm run test:e2e         # creates/schemas logger_test, then playwright test
npm run bench:seed       # builds the benchmark corpus in logger_bench (BENCH_EVENTS=500000 by default)
npm run bench            # vitest bench — measures whatever DATABASE_URL points at
npm run demo              # node scripts/demo-live.mjs (seeds a running instance via the ingest API)
```

## Local development environment

```bash
docker compose -f docker-compose.dev.yml up -d   # Postgres 16 on :5432, ClickHouse 25.3 on :8123
npm install
npm run db:bootstrap                              # applies both schemas — idempotent, safe to re-run
npm run dev                                       # app on http://localhost (port 80)
```

E2E tests do **not** run against this dev database — they need a one-time separate setup (`logger_test` database + `.env.e2e.local`); see [misc.md#testing](misc.md#testing) before running `npm run test:e2e` for the first time.

**Four databases in each store**, with the same four names on both: `logger` (dev), `logger_test` (e2e), `logger_itest` (integration), `logger_bench` (benchmarks). Only `logger` is set up by hand, with `npm run db:bootstrap`; `npm run test:e2e`, `npm run test:it` and `npm run bench:seed` each create and schema their own pair. No database is ever created by hand except the dev one.

Their lifetimes differ, and since 2026-08-26 two of them are **dropped and recreated on every run**:

| Database | Lifetime | Why |
|---|---|---|
| `logger_itest` | dropped and recreated each `npm run test:it` | ~40 rows, ~1 s. Recreated rather than reused because `db/schema.sql` is applied *additively* and cannot remove a table — Phase 4 deleted six, and a leftover `events` with its foreign key to `projects` blocks the fixture's own cleanup |
| `logger_test` | dropped and recreated each `npm run test:e2e` | Same reason. The stale foreign key broke `resetDb()` in every spec with a constraint violation over rows nothing writes any more |
| `logger_bench` | seeded once, reused | 500k rows, ~14 s. `npm run bench:seed` truncates and refills rather than dropping |
| `logger` | yours | **After a schema change that removes a table, recreate it**: `docker compose -f docker-compose.dev.yml down -v` then `npm run db:bootstrap`. Nothing detects a stale one and nothing warns |

Override the Postgres connections with `ITEST_DATABASE_URL` / `ITEST_ADMIN_URL` / `BENCH_DATABASE_URL`, and the ClickHouse ones with `ITEST_CLICKHOUSE_URL` / `_USER` / `_PASSWORD` / `_DATABASE` and `BENCH_CLICKHOUSE_URL` / `_USER` / `_PASSWORD` / `_DATABASE`. The e2e side reads the ordinary `CLICKHOUSE_*` names out of `.env.e2e.local`, and its bootstrap **refuses to run** if that file names `logger` — the suite truncates `events` between specs.

Benchmarks have no ClickHouse database: nothing they measure reads it yet.

`docker-compose.dev.yml` runs the stock `postgres:16` image and mounts `db/init/01-extensions.sql` (`CREATE EXTENSION IF NOT EXISTS pg_stat_statements` at container init) plus a named volume for data persistence. It built a custom image until 2026-08-26, for one apt package — `postgresql-16-partman` — needed by one table that is now in ClickHouse.

**Postgres settings** are passed on the command line by both compose files (added 2026-08-20 — before that there was no `command:` and no mounted config, so nothing was adjustable). `shared_preload_libraries=pg_stat_statements` is fixed; the ten below are overridable. They are read by Docker Compose, **not** by the application — they are absent from `core/env/index.ts` on purpose, and `npx tsc` will never catch a typo in one.

| Variable | Setting | Compose fallback | Shipped in `.env.production.example` |
|---|---|---|---|
| `PG_SHARED_BUFFERS` | `shared_buffers` | `128MB` | `2GB` |
| `PG_WORK_MEM` | `work_mem` | `4MB` | `32MB` |
| `PG_EFFECTIVE_CACHE_SIZE` | `effective_cache_size` | `4GB` | `5GB` |
| `PG_MAINTENANCE_WORK_MEM` | `maintenance_work_mem` | `64MB` | `512MB` |
| `PG_RANDOM_PAGE_COST` | `random_page_cost` | `4.0` | `1.1` |
| `PG_EFFECTIVE_IO_CONCURRENCY` | `effective_io_concurrency` | `1` | `200` |
| `PG_MAX_PARALLEL_WORKERS_PER_GATHER` | `max_parallel_workers_per_gather` | `2` | `2` |
| `PG_JIT` | `jit` | `on` | `off` |
| `PG_TRACK_IO_TIMING` | `track_io_timing` | `off` | `on` |
| `PG_LOG_TEMP_FILES` | `log_temp_files` | `-1` | `10MB` |

**ClickHouse settings** work the same way, through `db/clickhouse/config.d/logger.xml` rather than a command line. The XML reads each from the environment with `from_env` and carries the stock value inline as the fallback.

| Variable | Setting | Compose fallback | Shipped in `.env.production.example` |
|---|---|---|---|
| `CLICKHOUSE_MAX_SERVER_MEMORY` | `max_server_memory_usage` (bytes) | `0` — i.e. ClickHouse's own `max_server_memory_usage_to_ram_ratio` | `3221225472` (3 GiB) |
| `CLICKHOUSE_MARK_CACHE_SIZE` | `mark_cache_size` (bytes) | `5368709120` (5 GB, stock) | `536870912` (512 MiB) |
| `CLICKHOUSE_LOG_LEVEL` | `logger.level` | `warning` | `warning` |

All three carry `replace="replace"` in the XML. Without it ClickHouse refuses to start — `Element <level> has value and does not have 'replace' attribute, can't process from_env substitution` — because it will not silently overwrite an element that already holds a value. Found the first time the service was brought up, 2026-08-26.

**The mount is a file, not the directory.** Mounting over `/etc/clickhouse-server/config.d` hides what the image put there, including `docker_related_config.xml` — the only place `listen_host` is set. ClickHouse then binds 127.0.0.1 *inside* the container, its own healthcheck (which also runs inside) keeps reporting healthy, and every request from outside fails as "Empty reply from server". `logger.xml` sets `listen_host` again anyway, as insurance against that file moving.

**The compose fallbacks are Postgres 16 stock values and stay that way** — a compose file cannot know its host, and a default sized for ours would be wrong for every other install. The sized profile lives in `.env.production.example`, next to the arithmetic each number came from; it targets **8 GB RAM / 4 vCPU / NVMe with the app and worker on the same host**. Recompute for different hardware rather than copying. The last two rows are instruments rather than tuning: they change no plan, and they are what makes an I/O wait or a `work_mem` spill visible instead of merely slow.

Until 2026-08-24 the profile was commented out and the install ran entirely on stock, including `shared_buffers=128MB` against a multi-gigabyte `events` table. `PLAN.md` §16.1 Stage C had deferred picking values until they could be measured on the real host; §17 records what was chosen and why.

`db/postgres-tuning.test.mjs` asserts the three files agree — same variable set in both compose files, every variable documented in the example, every documented variable actually read, and the fallbacks still stock. It checks shape, not values: it cannot tell whether `32MB` is a good number, only that a knob has not gone missing from one file. That check exists because `docker-compose.dev.yml` claimed to "mirror the production command" for four days while exposing two of the five knobs production had.

`pg_stat_statements` needs both the preload flag (restart) and `CREATE EXTENSION` per database. The init script covers a fresh data directory only; on an existing install:

```bash
docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "CREATE EXTENSION IF NOT EXISTS pg_stat_statements"'
``` It defines **only** the `postgres` service — no app/worker containers in dev; you run those with `npm run dev` / the worker toggle below.

`docker-compose.dev.yml` deliberately keeps the **default** project name (the folder name, `logger`), while the production `docker-compose.yml` declares `name: logger-prod`. Without that split both files share one namespace and running the production stack in a developer checkout recreates the dev Postgres container and points production at the dev data volume.

> **Production packaging exists as of 2026-08-13** (Feature 08): multi-stage `Dockerfile`, production `docker-compose.yml` (six services), `Caddyfile`, backup/restore scripts, and two GitHub Actions workflows. See [misc.md#deployment](misc.md#deployment) for what each artifact does and [`docs/OPERATIONS.md`](../OPERATIONS.md) for how to run it.

## Environment variables

Eight variables are schema-validated (`core/env/index.ts`, via `@t3-oss/env-nextjs` + Zod, all server-only, fail-fast at boot if invalid). Expanded from four on 2026-08-13:

| Variable | Zod rule | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | `z.string().url()`, required | — | Postgres connection string |
| `CLICKHOUSE_URL` | `z.string().url()` | `http://localhost:8123` | ClickHouse HTTP interface. **Not** the native protocol on 9000 — `@clickhouse/client` speaks HTTP, and it is the port the healthcheck and any debugging `curl` use |
| `CLICKHOUSE_USER` | `z.string().min(1)` | `logger` | |
| `CLICKHOUSE_PASSWORD` | `z.string()`, required | — | Required so a deploy cannot forget it. No `.min(1)`: an empty string is a valid ClickHouse password meaning "no password", and rejecting it would break a legitimate local setup |
| `CLICKHOUSE_DATABASE` | `z.string().min(1)` | `logger` | |
| `AUTH_SECRET` | `z.string().min(32)`, required | — | better-auth session/token signing secret (`openssl rand -base64 32` yields 44 chars) |
| `APP_URL` | `z.string().url()` | `http://localhost` | Base URL for every generated link — password reset, invites, **and the alert-webhook `events_url` deep link** |
| `NODE_ENV` | `z.enum(["development","test","production"])` | `development` | Standard Node env |
| `LOG_LEVEL` | `z.enum(["fatal","error","warn","info","debug","trace"])` | `info` | pino log level for the app logger |
| `WORKER_IN_PROCESS` | `z.enum(["true","false"])` → `boolean` | `false` | If true, starts the pg-boss worker (partition maintenance, alert evaluation/delivery) inside the Next.js process — convenient for dev/single-instance, not the intended prod topology (see [architecture.md](architecture.md#background-jobs)) |
| `RATE_LIMIT_PER_MIN` | `z.coerce.number().int().positive()` | `1000` | Fallback per-API-key ingest rate limit (events per 60s), for keys with no per-key override |
| `ALLOW_PRIVATE_WEBHOOK_TARGETS` | `z.enum(["true","false"])` → `boolean` | `false` | Opt-out of the alert-webhook SSRF guard, permitting private/loopback targets. Only for self-hosted installs posting to a service on the same network — see [security.md](security.md#outbound-request-safety-ssrf) |

**`isServer` is set explicitly** on `createEnv` rather than left to the library default. `@t3-oss/env-nextjs` probes `typeof window === "undefined"` to decide server vs. client; Vitest runs service and util suites under **jsdom**, where that probe reports "client" and the proxy then throws on any server-variable access. The override adds `|| process.env.NODE_ENV === "test"`, which is only ever true under the test runner. Without it, importing `@/core/env` anywhere in a module under test breaks the suite.

The following are still read via raw, unvalidated `process.env` — build- and test-time concerns rather than runtime config, so a malformed value cannot break a running app:

| Variable | Default | Purpose |
|---|---|---|
| `NEXT_PUBLIC_BUILD_SHA` | — | Build SHA, exposed via `GET /api/version`. Inlined by `next build`; set as a Docker build arg by `release.yml`. Setting it at run time has no effect |
| `NEXT_PUBLIC_BUILD_TIME` | — | Build timestamp, same mechanics |
| `PORT` | `3000` (baked into the image) | Port the Next.js standalone server binds. Read by `server.js` itself, not by our code, so it is not in the Zod schema. Referenced by the compose healthcheck and must match `reverse_proxy app:3000` in the `Caddyfile` |
| `HOSTNAME` | `0.0.0.0` (baked into the image) | Interface the standalone server binds. The default is localhost, which inside a container means the proxy cannot reach it |
| `SCHEMA_DIR` | `.`, `/app/schema` in the image | Prefix `core/db/bootstrap.ts` joins to `db/schema.sql` and `core/clickhouse/schema.sql`. The image keeps the repo-relative sub-paths rather than flattening them, so one pair of strings works in a checkout and in the container |
| `E2E_MODE` | unset | Set to `"true"` only by `playwright.config.ts`'s `webServer`. `next dev` hardcodes `NODE_ENV=development` regardless of what's passed in, so this app-specific flag exists to detect "running as the e2e server" where `NODE_ENV` can't be used: `next.config.ts` uses it to pick a separate build dir (`.next-e2e`, avoiding a lock conflict with the normal dev server's `.next`), and `proxy.ts` uses it to disable a 5s in-memory cache that would otherwise survive a test-database reset. See [misc.md#testing](misc.md#testing) |

> **Removed 2026-08-13: `NEXT_PUBLIC_APP_URL`.** It was read only by the alert-webhook payload builder and was never defined in `.env.example` or the env schema, so every webhook shipped an `events_url` built from its `http://localhost:3000` fallback — broken in any real deployment, and silently so. That builder now reads the validated `APP_URL`.

`.env.example` at the repo root documents the commonly-needed subset. Copy it to `.env.local` for local dev.
