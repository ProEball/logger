# Stack, Dependencies & Environment

## Runtime requirements

| Requirement | Version / detail |
|---|---|
| Node.js | Version matching `next: 16.2.4` / `react: 19.2.4` requirements (Node 20+ recommended; `@types/node` targets `^20`) |
| PostgreSQL | **16**, with the **`pg_partman`** extension installed (see [architecture.md](architecture.md#events-partitioning)) |
| OS | Any (dev instructions assume Windows/PowerShell per this repo's environment, but the app itself is platform-agnostic) |
| Package manager | npm (`package-lock.json` present) |

The app binds to **port 80** directly in both `dev` and `start` scripts (`next dev -p 80`, `next start -p 80`) — not the Next.js default 3000. Keep this in mind when writing reverse-proxy config or Docker port mappings.

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
| `drizzle-kit` (`^0.31.10`, dev) | Migration generation/apply/push/studio CLI |
| `postgres` (`^3.4.9`) | Low-level Postgres driver (`postgres.js`), wrapped in a slow-query-logging proxy |
| `pg-boss` (`^12.18.2`) | Postgres-backed job queue/scheduler (cron jobs + on-demand work) — no Redis, no separate message broker |

Database migrations are managed by Drizzle Kit from `core/db/schema/index.ts`, output to `core/db/migrations/`. One migration (`0003_giant_thena.sql`) is **hand-written raw SQL**, not Drizzle-kit-generated, because table partitioning (`PARTITION BY RANGE`) and `pg_partman` integration aren't expressible in Drizzle's schema DSL.

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

## npm scripts

```bash
npm run dev          # next dev -p 80
npm run build         # next build
npm run start         # next start -p 80
npm run lint           # eslint
npm run db:generate    # drizzle-kit generate
npm run db:migrate     # drizzle-kit migrate
npm run db:push        # drizzle-kit push (dev convenience, no migration file)
npm run db:studio      # drizzle-kit studio
npm run test            # vitest run
npm run test:e2e         # playwright test --pass-with-no-tests
npm run db:migrate:e2e    # applies migrations to the isolated e2e database (logger_test) — see misc.md#testing
npm run demo              # node scripts/demo-live.mjs (seeds a running instance via the ingest API)
```

## Local development environment

```bash
docker compose -f docker-compose.dev.yml up -d   # starts Postgres 16 + pg_partman on :5432
npm install
npm run db:migrate
npm run dev                                       # app on http://localhost (port 80)
```

E2E tests do **not** run against this dev database — they need a one-time separate setup (`logger_test` database + `.env.e2e.local`); see [misc.md#testing](misc.md#testing) before running `npm run test:e2e` for the first time.

`docker-compose.dev.yml` builds `db/Dockerfile` (`postgres:16` + `postgresql-16-partman` apt package) and mounts `db/init/01-extensions.sql` (runs `CREATE EXTENSION IF NOT EXISTS pg_partman;` at container init) plus a named volume for data persistence. It defines **only** the `postgres` service — no app/worker containers in dev; you run those with `npm run dev` / the worker toggle below.

> **Note:** a full production Docker packaging (multi-stage app image, separate worker container, Caddy reverse proxy, backup container) is *planned* (`docs/features/08-docker-packaging.md`) but **not yet implemented** — only `db/Dockerfile` and `docker-compose.dev.yml` exist today. See [misc.md](misc.md#deployment) for the current vs. planned state.

## Environment variables

Eight variables are schema-validated (`core/env/index.ts`, via `@t3-oss/env-nextjs` + Zod, all server-only, fail-fast at boot if invalid). Expanded from four on 2026-08-13:

| Variable | Zod rule | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | `z.string().url()`, required | — | Postgres connection string |
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
| `NEXT_PUBLIC_BUILD_SHA` | — | Build SHA, set by CI, exposed via `GET /api/version` |
| `NEXT_PUBLIC_BUILD_TIME` | — | Build timestamp, set by CI, exposed via `GET /api/version` |
| `E2E_MODE` | unset | Set to `"true"` only by `playwright.config.ts`'s `webServer`. `next dev` hardcodes `NODE_ENV=development` regardless of what's passed in, so this app-specific flag exists to detect "running as the e2e server" where `NODE_ENV` can't be used: `next.config.ts` uses it to pick a separate build dir (`.next-e2e`, avoiding a lock conflict with the normal dev server's `.next`), and `proxy.ts` uses it to disable a 5s in-memory cache that would otherwise survive a test-database reset. See [misc.md#testing](misc.md#testing) |

> **Removed 2026-08-13: `NEXT_PUBLIC_APP_URL`.** It was read only by the alert-webhook payload builder and was never defined in `.env.example` or the env schema, so every webhook shipped an `events_url` built from its `http://localhost:3000` fallback — broken in any real deployment, and silently so. That builder now reads the validated `APP_URL`.

`.env.example` at the repo root documents the commonly-needed subset. Copy it to `.env.local` for local dev.
