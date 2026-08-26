# CLAUDE.md

Guidance for Claude Code working in this repository.

## What this is

**Logger** — a self-hosted, invite-only, multi-tenant structured event logging / observability service. An **organization** owns **projects**; each project ingests **events** over an HTTP API authenticated by a per-project **API key**; users browse and filter those events, watch a metrics **dashboard**, and configure **alert rules** that evaluate on a schedule and fire webhooks.

One Next.js deployable plus an optional worker process, backed by **two stores**: PostgreSQL for everything about people and projects, and ClickHouse for the events themselves. No Redis, no external queue, no third-party services.

The split is clean and it is worth knowing before opening a file: Postgres holds users, organizations, projects, API keys and alert rules; ClickHouse holds `events` and nothing else. Nothing joins across them — a cross-store question is one query to each, issued concurrently and matched in TypeScript. **There is no Drizzle dialect for ClickHouse**, so every read and write of an event is raw SQL and parameter binding is a rule rather than a library guarantee (`core/clickhouse/params.ts`, `docs/reference/security.md`).

Next.js 16 App Router · React 19 · TypeScript `strict` · Drizzle + postgres.js · @clickhouse/client · better-auth · pg-boss · Redux Toolkit · SCSS Modules (no Tailwind) · Zod · Recharts.

> `AGENTS.md` at the repo root warns that this Next.js version has breaking changes versus older training data — e.g. `middleware.ts` is now `proxy.ts`. Read `node_modules/next/dist/docs/` before writing framework-adjacent code instead of relying on recall.

## Where the truth lives

**`docs/reference/` is authoritative for "what the code does right now."** It is regenerated from the codebase, and where the planning docs disagree with it, it wins. Read the relevant file before answering questions about behaviour — do not reconstruct from memory.

| Doc | Covers |
|---|---|
| `docs/reference/stack.md` | Dependencies, environment variables, npm scripts, local setup |
| `docs/reference/architecture.md` | Folder layout, layering rules, DB schema, background jobs |
| `docs/reference/api.md` | HTTP API — ingest, health, version, Server Action conventions |
| `docs/reference/users-roles.md` | Orgs, membership, roles, permissions, invitations |
| `docs/reference/logging.md` | Event data model, filtering, dashboard, alerts |
| `docs/reference/widgets.md` | Every read surface: which query backs it, what it groups by, what it costs |
| `docs/reference/security.md` | AuthN/AuthZ, API keys, rate limiting, CSP/headers, SSRF, known gaps |
| `docs/reference/misc.md` | Testing, deployment, i18n, theming, the app's own logger |

`docs/PROGRESS.md` — current phase, blockers, what is done. Start here after a break.
`docs/PLAN.md` — original design intent and the cross-cutting decision log (§17).
`docs/features/00-08*.md` — per-feature specs and checklists.

Planning docs record **intent and history**; they have drifted from the implementation in places and say so.

## Commands

```bash
npm run dev              # dev server on http://localhost (port 80, not 3000)
npm run build            # production build
npm run start            # production server, also port 80
npm run lint             # eslint — must stay at 0 problems
npm run test             # vitest — unit only, no database needed
npm run test:it          # vitest integration — creates/seeds logger_itest, needs Postgres up
npm run test:e2e         # playwright (needs the isolated e2e DB — see misc.md#testing)
npx tsc --noEmit         # type check — must stay at 0 errors
npm run db:schema        # regenerate db/schema.sql from the Drizzle schema
npm run db:bootstrap     # apply db/schema.sql + core/clickhouse/schema.sql
npm run db:studio        # drizzle-kit studio
```

Postgres **and ClickHouse** for local dev:
`docker compose -f docker-compose.dev.yml up -d`, then `npm run db:bootstrap`.

**There are no migrations.** Each store has one file describing its end state,
applied from empty and idempotently. Change `core/db/schema/*.ts` then re-run
`npm run db:schema` — never hand-edit `db/schema.sql`. See
`docs/reference/architecture.md`, and `PLAN.md` §17 for the cost.

## Structure

```
app/          Next.js App Router only — routes compose, they never implement
core/         app-wide: db, clickhouse, auth, env, store, i18n, theme, logger, worker
features/     alerts api-keys auth dashboard events help ingest
              organizations overview projects roles
shared/       cross-feature components, hooks, types, utils, permissions
db/           generated Postgres baseline + init SQL (pg_stat_statements)
e2e/          Playwright specs + support helpers
docs/         see above
proxy.ts      auth gating + per-request CSP nonce (Next 16's middleware)
```

## Non-negotiables

Two rules apply to **every** change, no exceptions — details and the exact doc mapping in `rules/WORKFLOW.md`:

1. **Behaviour change → docs updated in the same change.** Undocumented behaviour is treated as a defect, not a shortcut.
2. **Logic added or changed → covered by tests in the same change.** A change that cannot be tested needs its untestability explained, not waived silently.

Neither is delegable. `WORKFLOW.md` §3 says what a subagent *is* for — auditing (read-only, so it reports rather than writes) and the descriptive half of `docs/reference/` — and why tests for code you just wrote, and anything answering "why", are not on that list.

@rules/WORKFLOW.md
@rules/PROJECT.md
