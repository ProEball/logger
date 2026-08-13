# 08. Docker packaging

## Status
- [ ] Not started · [ ] In progress · [x] Done
- Started: 2026-08-13
- Completed: 2026-08-13
- Last touched: 2026-08-13 (implementation + live check)
- Progress: 30 / 30 checklist items

> **Four errors in this doc as written were corrected during implementation.**
> They are marked ⚠️ at the relevant checklist items; the summary is here so
> nobody re-derives them from the checklist alone.
>
> 1. **Steps 12 and 15 said port 3000, and the objection to that was itself
>    half-right.** The app's npm scripts use `-p 80`, so `reverse_proxy app:3000`
>    looked wrong — but the container never runs `next start`. It runs
>    `.next/standalone/server.js`, which reads `PORT`. The port is now pinned
>    explicitly at 3000, so both lines are correct for a reason the doc never
>    gave. See PLAN.md §15.1 and §17.
> 2. **Nothing said Caddy must not add security headers.** The app emits a
>    per-request nonce CSP; a browser enforces every CSP header it receives and
>    the proxy cannot know the nonce, so a proxy-side policy blocks the nonced
>    inline scripts Next uses to boot the client. The `Caddyfile` now says so
>    inline.
> 3. **`NODE_ENV` was set nowhere.** Q-H2 runs the worker as plain
>    `node dist/worker.js` and step 22's env template omitted `NODE_ENV`
>    entirely, so the worker and migrate containers would have run in
>    development mode — HSTS aside, that changes the pooled-client global in
>    `core/db/client.ts`. It is now baked into the image so all three processes
>    inherit it.
> 4. **Step 5's `< 250 MB` target was set without measuring and is not
>    reachable.** The Node 22 binary alone is 123 MB; the real image is ~306 MB.
>    See the note at step 5.

## Goal

Production-ready Docker deployment. Multi-stage app image, separate worker container reusing the same image, custom Postgres with pg_partman, Caddy reverse proxy with auto Let's Encrypt, nightly backup container with offsite rclone copy, healthchecks wired into compose, migrations via one-shot init container. Outputs a `docker compose up -d` deployment that boots clean from a fresh host.

## Prerequisites

- ✅ Features 01–07 (need a polished, working app to package)

## Locked decisions

| ID | Question | Resolution |
|---|---|---|
| Q-H1 | App multi-stage build | 3 stages: deps → builder → runner. `next.config.ts` set to `output: 'standalone'` for minimal runtime artifact. |
| Q-H2 | Worker container | Same image as app, different entrypoint (`node dist/worker.js`). |
| Q-H3 | Postgres image | Reuse the custom image built in feature 03 (`./db/Dockerfile` with pg_partman). |
| Q-H4 | Secrets / env | `.env` file on host (mode 600), mounted via `env_file:` in compose. |
| Q-H5 | Migration strategy | One-shot `migrate` init container. App and worker depend on `service_completed_successfully`. |
| Q-H6 | Backup scheduling | **Dev**: no backup container (keeps dev clean). **Prod**: in-container `while sleep` loop. Local retention max **3 files**. Frequency + count env-configurable (`BACKUP_INTERVAL_HOURS`, `BACKUP_RETENTION_COUNT`). Offsite via rclone — bucket lifecycle handles its own retention (out of script scope). |
| Q-H7 | Health probes | HTTP for app / postgres / proxy. Worker uses file-mtime probe (touches `/tmp/worker-alive` in main loop; healthcheck asserts mtime < 60s). |

## Architecture

```
Internet
    │
    ▼
┌─────────────┐
│ proxy       │  Caddy:2-alpine, ports 80/443, auto Let's Encrypt
│             │
└──────┬──────┘
       │ proxy_pass
       ▼
┌─────────────┐    ┌─────────────┐
│ app         │    │ worker      │  Same image, different cmd
│ Next.js     │    │ pg-boss     │  Runs alert evaluator + partman maintenance
│ standalone  │    │ scheduler   │
└──────┬──────┘    └──────┬──────┘
       │                  │
       └────────┬─────────┘
                ▼
       ┌─────────────────┐
       │ postgres        │  Custom image with pg_partman
       │                 │
       └────────┬────────┘
                │
                ▼
       ┌─────────────────┐         ┌──────────────────┐
       │ backup          │ ──rclone──▶ │ Offsite (S3-compat) │
       │ pg_dump nightly │         │                      │
       └─────────────────┘         └──────────────────────┘

       (one-shot)
       ┌─────────────────┐
       │ migrate         │  Runs once, exits 0, gates app/worker startup
       │ Drizzle migrate │
       └─────────────────┘
```

## Server-side artifacts

### Files

```
Dockerfile                          — multi-stage app + worker
.dockerignore
docker-compose.yml                  — production
docker-compose.dev.yml              — already exists from feature 00 (no backup)
Caddyfile                           — reverse proxy config (domain placeholder)
db/Dockerfile                       — already exists from feature 03 (Postgres + partman)
db/init/01-extensions.sql           — already exists from feature 03

scripts/
  backup.sh                         — pg_dump + rotation + rclone
  restore.sh                        — pg_restore from a chosen file
  worker-entrypoint.sh              — node dist/worker.js with health-touch
  migrate-entrypoint.sh             — drizzle-kit migrate

.env.production.example             — all required vars, with comments
docs/OPERATIONS.md                  — deployment, backup/restore, log inspection
```

### `next.config.ts` adjustment
Set `output: 'standalone'` so the app stage produces `.next/standalone/server.js`.

### Worker entrypoint
`worker.ts` (in repo root or `worker/`):
- Boots pino
- Connects to DB
- Initializes pg-boss
- Registers handlers from `features/alerts/jobs/` and `features/ingest/jobs/` (full list maintained here — every new background job appends)
- Starts a "alive" loop: `setInterval(() => fs.utimesSync('/tmp/worker-alive', new Date(), new Date()), 30000)` — **single source of truth for the health-touch**. The compose `healthcheck` reads the file's mtime; no duplication elsewhere.
- Graceful shutdown on SIGTERM (stop pg-boss, clear interval, exit 0)

## Implementation Checklist

### Multi-stage Dockerfile
- [x] 1. `Dockerfile` with three stages:
  - `deps`: `npm ci` — ⚠️ **not** `--omit=dev`. The build needs next/typescript/sass/esbuild, and the runner takes its dependencies from the pruned `node_modules` that `output: 'standalone'` emits, so a second production-only install would be copied nowhere.
  - `builder`: `npm run build` (Next build + esbuild bundles). Build-time `DATABASE_URL`/`AUTH_SECRET` placeholders are set on the `RUN` line, not via `ENV`, so they do not persist into stage metadata.
  - `runner`: **`node:22-alpine`** (not 20 — matches CI and the esbuild target), copies `.next/standalone`, `.next/static`, `public`, both bundles and `core/db/migrations`; runs as the stock non-root `node` user.
- [x] 2. Set `next.config.ts: { output: 'standalone' }`. **Also `outputFileTracingIncludes: { "/*": ["docs/reference/**/*.md"] }`** — not in the original plan and not optional: the help centre reads those files via `process.cwd()` at runtime, which Next's tracer cannot see, so without it every help page 500s in production while working in dev.
- [x] 3. `.dockerignore` excludes `node_modules`, `.next`, `dist`, `e2e`, tests, `.env*`, `.git`, `.github`, `docs` — **with `!docs/reference`**, per step 2.
- [x] 4. Worker bundle via **esbuild** (`scripts/build-worker.mjs`), as decided. Bundles two entrypoints, not one: `core/worker/main.ts` → `dist/worker.js` and `core/db/migrate.ts` → `dist/migrate.js`. CJS, `target: node22`, dependencies inlined, `@` alias mirroring tsconfig. Wired into `npm run build`, so a broken bundle fails the normal build gate.
- [x] 5. Live check: `docker build .` succeeds. ⚠️ **Image is ~306 MB, not < 250 MB, and the target was never reachable.** Measured breakdown: Node 22 binary 123 MB, application content ~56 MB (`.next` 18 MB, standalone `node_modules` 35 MB — of which `@img`/`sharp` is 17 MB — and 2.5 MB of bundles), the rest alpine + npm. `sharp` is traced in because Next always traces the image optimiser; it is dead weight today (nothing imports `next/image`) but excluding it would silently break images the day someone adds one. **Revised target: < 350 MB**, which is what `node:22-alpine` + Next standalone actually costs. Getting materially below that means leaving alpine for distroless, which is not worth it for a self-hosted tool.

### Worker entrypoint
- [x] 6. `core/worker/main.ts` — starts pg-boss via the shared `startWorker()`, starts the health-touch, installs SIGTERM/SIGINT handlers. Kept thin: job registration stays in `core/worker/worker.ts` so the in-process dev path and the container path cannot diverge. The health-touch (`health-touch.ts`) and signal handling (`shutdown.ts`) are separate modules because both have real branches worth testing.
- [x] 7. ⚠️ **No `scripts/worker-entrypoint.sh`.** The stated purpose was "so SIGTERM reaches the Node process", which the exec-form `command: ["node", "worker.js"]` already guarantees — Node is PID 1 and receives the signal directly. A wrapper script would add a layer without adding anything. The rest of the item stands: the health-touch lives in the worker process, never in a shell loop, precisely so a dead process cannot keep reporting healthy.
- [x] 8. Live check (2026-08-13): container runs, pg-boss connects, `/tmp/worker-alive` is created and fresh. Probe verified in both directions — `find /tmp/worker-alive -mmin -1` exits 0 against a live worker and 1 against a backdated file. SIGTERM produces a clean drain and exit 0 in ~12 ms. **Not verified:** the container flipping to `unhealthy` after a wedge. A killed Node process takes PID 1 with it (the container exits instead), and a live worker re-touches the file within 30 s, so the stale-file path needs a genuinely hung process to reproduce.

### Migration init container
- [x] 9. ⚠️ **`core/db/migrate.ts` → `dist/migrate.js`, not `scripts/migrate-entrypoint.sh` + `npx drizzle-kit migrate`.** drizzle-kit is a dev dependency that carries its own esbuild and TypeScript, and it reads `drizzle.config.ts`, which wants `dotenv` and a `.env.local` no container has. drizzle-orm's programmatic migrator needs none of that and writes the same `drizzle.__drizzle_migrations` table. Exits 0 on success, 1 on failure. See PLAN.md §17.
- [x] 10. Compose service `migrate` uses the same image with `command: ["node", "migrate.js"]` and `restart: "no"` (overriding the shared anchor's `unless-stopped`).
- [x] 11. `app` and `worker` declare `depends_on: { migrate: { condition: service_completed_successfully }, postgres: { condition: service_healthy } }`.

### Caddyfile
- [x] 12. `Caddyfile` with `{$DOMAIN}` placeholder (compose substitutes from env). `reverse_proxy app:3000` — ⚠️ correct, see the status-block note. Adds `encode` and JSON access logging; adds **no** security headers, with the reasoning inline. `DOMAIN=:80` serves plain HTTP and skips ACME, for local testing.
- [x] 13. Volumes: `caddy_data` (certificates, ACME account keys), `caddy_config`. Persistent across restarts.

### Production compose
- [x] 14. `docker-compose.yml` (production) — services: `proxy`, `app`, `worker`, `postgres`, `migrate`, `backup`. Additions the plan did not have: a top-level **`name: logger-prod`** (without it the dev and prod stacks share a project namespace and prod adopts the dev data volume — observed), a YAML anchor so the three application services provably share one image, and **no `ports:` on `postgres`** (publishing 5432 would expose it to the internet on most VPS firewall setups).
  - `app` depends on migrate (completed) + postgres (healthy).
  - `worker` same.
  - `proxy` depends on `app`.
  - `backup` depends on `postgres` (healthy).
  - **`worker` service: `deploy.replicas: 1`** — backstop for the pg-boss singleton schedules (alert evaluator, partman maintenance). pg-boss `singletonKey` already prevents double execution at the queue level, but pinning replicas to 1 also prevents the brief overlap window during a `compose up -d` rolling restart.
  - `migrate` runs the migration entrypoint and exits 0; `app` and `worker` declare `depends_on: { migrate: { condition: service_completed_successfully } }`. `migrate` requires `env_file` with `DATABASE_URL` (drizzle-kit needs it).
- [x] 15. Health probes per service:
  - `app`: `wget -q --spider http://127.0.0.1:${PORT:-3000}/api/health/ready`, interval 30s, `start_period: 40s`. ⚠️ Port 3000 is correct — see the status-block note. Read from the environment so there is one number to change rather than three.
  - `postgres`: `pg_isready -U $$POSTGRES_USER -d $$POSTGRES_DB`, interval 10s.
  - `proxy`: `wget -q --spider http://127.0.0.1:2019/config/` (Caddy admin API).
  - `worker`: `test -n "$$(find /tmp/worker-alive -mmin -1)"` — touched by the worker process itself (step 6).
- [x] 16. Restart policy `unless-stopped` for app, worker, postgres, proxy, backup. `no` for migrate. `worker` also gets `stop_grace_period: 30s`, which must stay above `SHUTDOWN_TIMEOUT_MS` (20s) in `core/worker/worker.ts` or Docker SIGKILLs the drain.

### Backup script (prod-only)
- [x] 17. `scripts/backup.sh`, running in a dedicated image (`db/backup.Dockerfile` = `postgres:16-alpine` + `rclone`; the stock postgres image has neither rclone nor a cron daemon). Config:
  - `BACKUP_INTERVAL_HOURS` (default 24)
  - `BACKUP_RETENTION_COUNT` (default 3)
  - `RCLONE_REMOTE` (e.g. `b2:logger-backups/<host>`) — required if offsite enabled, optional if `OFFSITE=false`
  - Loop: `pg_dump -Fc` → file `backups/$(date +%Y%m%d-%H%M%S).dump` → rotate (keep newest N) → `rclone copy` to offsite (if configured) → sleep `INTERVAL_HOURS * 3600`
  - Added beyond the plan: the dump is written to a `.partial` name and renamed on success, so a dump interrupted by a container restart cannot sit in the directory looking like a valid backup and get a good one rotated out in its favour. The container refuses to start if `OFFSITE=true` without a remote, or without rclone present, rather than silently skipping every upload for a month.
  - The offsite remote is configured through rclone's own `RCLONE_CONFIG_*` environment variables instead of `RCLONE_CONFIG` + a mounted `rclone.conf`: it keeps every secret in the one mode-600 `.env`, and a bind mount of a file that does not exist yet is silently created by Docker as an empty *directory*.
- [x] 18. Local rotation: `ls -1t backups/*.dump | tail -n +$((COUNT+1)) | xargs -r rm`. Verified with 6 files and `BACKUP_RETENTION_COUNT=3`.
- [x] 19. Backup on first start: runs once immediately, then enters the sleep loop. A failed cycle does not kill the loop.
- [x] 20. Live check (2026-08-13): `docker compose up -d backup` → dump appears in the volume within seconds → `pg_restore --list` reads it (386 TOC entries, custom format, gzip).

### Restore script
- [x] 21. `scripts/restore.sh <dumpfile>` — ⚠️ **drops and recreates the database; `pg_restore --clean` does not work on this schema.** `events` is declaratively partitioned and each partition's primary key is an inherited constraint Postgres refuses to drop directly, so `--clean` aborts mid-drop with `cannot drop inherited constraint "events_pYYYYMMDD_pkey"`. Only surfaced by actually running a restore. Also added: an archive-readability precheck (`pg_restore --list`) before anything destructive happens, and `--exit-on-error` so a partial restore cannot exit 0. Confirmation prompt, skippable with `RESTORE_YES=true`. Documented in `docs/OPERATIONS.md`.

### .env.production.example
- [x] 22. `.env.production.example` documents every variable, annotated. Differences from the sketch above:
  - ⚠️ **`NODE_ENV` was missing entirely**, and Q-H2's plain `node dist/worker.js` sets it nowhere — the worker and migrate containers would have run in development mode. Resolved by baking `ENV NODE_ENV=production` into the image (all three processes inherit it) rather than relying on an env-file line someone can delete. The template explains this instead of setting it.
  - `ALERTS_WORKER_ENABLED` does not exist in this codebase. The real toggle is `WORKER_IN_PROCESS`, and in production it must stay **false** — the `worker` container is the job runner, and turning it on would give the alert evaluator a second scheduler racing the first.
  - `RCLONE_CONFIG` + a mounted `rclone.conf` replaced by rclone's `RCLONE_CONFIG_*` environment variables (see step 17).
  - `OFFSITE` defaults to **false**, not true — a template that defaults to "upload somewhere" with a placeholder bucket is a footgun.
  - Added: `APP_URL` (invite links and webhook `events_url` — wrong here means silently broken deep links), `LOG_LEVEL`, `RATE_LIMIT_PER_MIN`, `ALLOW_PRIVATE_WEBHOOK_TARGETS`, `PORT`, `IMAGE`.
- [x] 23. Documented in the template and `OPERATIONS.md`: `chmod 600`. ⚠️ **Not** `/etc/logger/.env` — the file must be named `.env` **next to `docker-compose.yml`**, because compose reads it twice and only one of those uses honours `--env-file`: `${VAR}` substitution inside the compose file itself (`DOMAIN`, `POSTGRES_*`, `PORT`) happens before `env_file:` is even considered. Symlink from `/etc/logger/.env` if a central location is wanted.

### Documentation
- [x] 24. `docs/OPERATIONS.md` covering all seven listed topics, plus a "what runs" service table and an operational-limits section carrying the known gaps forward (retention not enforced, in-memory rate limiter, password reset not emailed).
- [x] 25. README links to OPERATIONS.md.

### Build & publish
- [x] 26. `.github/workflows/release.yml`: on tag `v*`, builds and pushes to `ghcr.io/<owner>/logger` with GHA layer caching. Release notes are left to GitHub's own generator rather than duplicated by the workflow. **Also added `ci.yml`** — not in this checklist, but the repo had no CI at all, so nothing was verifying the four gates on push.
- [x] 27. Tags: exact version, `major.minor`, git SHA, and `latest` (suppressed for pre-release tags containing `-`, so an `rc` cannot become `latest`). Build args set `NEXT_PUBLIC_BUILD_SHA` and `NEXT_PUBLIC_BUILD_TIME`.

### Final verification
- [x] 28. Live check on a clean local Docker, 2026-08-13. **What was verified:**
  - Fresh volume → `postgres` healthy → `migrate` applied 7 migrations and exited 0 → `app` and `worker` both healthy; `proxy` healthy once `app` was.
  - Schema landed correctly: 34 public tables, 109 premade daily partitions, `part_config` showing `1 day` / `30 days`, all 7 rows in `drizzle.__drizzle_migrations`.
  - `/api/health/ready` → 200 with `migrations: "ok"` (this is what caught the wrong-schema bug), `/api/health` and `/api/version` both correct.
  - Through Caddy: exactly one `Content-Security-Policy` header, a different nonce per request, `<script>` tags carrying the matching nonce, `/setup` rendering 200, CSS and JS assets served. HSTS present, which confirms `NODE_ENV=production` reached the app.
  - Worker: pg-boss connected, all three queues and both cron schedules registered, `/tmp/worker-alive` fresh, probe correct in both directions, SIGTERM → clean drain → exit 0.
  - Backup: first dump within seconds, `pg_restore --list` reads it, rotation keeps N newest; restore guard rails reject a missing and a corrupt file; full drop-and-recreate restore succeeded and `app`/`worker` came back healthy against the restored database.

  **Not verified:** the setup-wizard → org → project → API key → curl event → events page → alert webhook path. Those flows are covered by the e2e suite against a dev server; what the container adds over that is the runtime/packaging dimension, which is what the above exercises. Worth doing once against a real staging host before the first tagged release, together with an offsite (`OFFSITE=true`) backup cycle, which was not exercised — no bucket was configured.
- [x] 29. PROGRESS.md updated.
- [x] 30. Status block updated.

## Live check (full)

See step 28 above.

## Tests

Unit coverage added with this feature (39 new tests, 293 → 332):

| File | Covers |
|---|---|
| `core/worker/worker.test.ts` | Queue creation and its ordering vs `work`/`schedule`, all three jobs registered, cron expressions and singleton keys, `startWorker` idempotence, `stopWorker` draining/clearing the singleton even when `stop()` throws |
| `core/worker/health-touch.test.ts` | File created immediately, mtime advancing on interval, stopping, unwritable path swallowed, recovery after a failed touch |
| `core/worker/shutdown.test.ts` | Exit 0 on clean drain, exit 1 on a failed one, a second signal mid-drain ignored |
| `core/db/migration-status.test.ts` | Correct schema qualifier, up-to-date / behind / never-migrated / ahead, string-count coercion |
| `core/db/middleware/slow-query-logger.test.ts` | No unhandled rejection on a failed query, caller still sees the rejection, threshold behaviour |
| `app/api/version/route.test.ts` | `""` and unset build args both falling back to `"dev"` |

`core/worker/main.ts` and `core/db/migrate.ts` have **no** unit tests: both are composition roots whose only behaviour is process-level side effects (signal handlers, `process.exit`, connecting to a real database). Their logic was extracted into the tested modules above precisely so the untestable remainder is trivial; they are covered by the live check instead.

`scripts/backup.sh` and `scripts/restore.sh` are POSIX shell and have no unit tests — vitest cannot run them and adding a shell test harness for two scripts is not worth the dependency. Both were exercised end-to-end in the live check, including their refusal paths.

CI (`ci.yml`) builds the image on every push, so a broken Dockerfile fails there rather than at deploy time. A smoke E2E against the compose stack remains out of scope.

## Open questions

- ✅ **Resolved: where to host the built image.** `ghcr.io/<owner>/logger`, pushed by `release.yml` using the workflow's own `GITHUB_TOKEN` (`packages: write`) — no separate registry credential to manage. Works for a private repo too; the package inherits the repo's visibility. Revisit only if images must be pulled by hosts that cannot authenticate to GitHub.
- ❓ Rate limiter is single-instance. If the app needs to scale to N replicas, switch to a shared store. Documented as a known limitation in `security.md` and `OPERATIONS.md`.
- ❓ **Offsite backups are untested.** `OFFSITE=true` was never exercised against a real bucket — no rclone remote was configured for the live check. The failure paths (missing remote, missing binary, failed upload) are covered; the success path is not. Do this before relying on offsite copies.
- ❓ **No staging host.** Everything was verified against local Docker. The two things local testing cannot cover are real ACME certificate issuance (`DOMAIN=:80` skips it entirely) and behaviour under real ingest load.

## Bugs found by this feature

Three defects, none of which could surface in development, all found by running the stack rather than by reading the code. Each is fixed with a regression test.

| Bug | Why dev never saw it |
|---|---|
| **pg-boss 12 requires `createQueue` before `schedule`/`work`** — the worker crash-looped on startup with `Queue partman-maintenance not found` | The dev database already had `pgboss.queue` rows from an earlier pg-boss version. It only fails against a database where they are missing, i.e. every fresh production one |
| **Every failed query raised an `unhandledRejection`** — `slow-query-logger.ts` forked a promise with no rejection handler, so a caller's own `try/catch` could not suppress it | Next traps the event and logs it, so it read as noise in a dev console. A bare Node process — the worker — would terminate on it |
| **`/api/health/ready` queried `__drizzle_migrations` unqualified**, so it resolved to `public`, raised `relation does not exist`, was caught, and reported `"unavailable"` | The check appeared to work because the endpoint still returned 200. It had never actually run, meaning an app on a half-migrated database passed its healthcheck |

The `/api/version` empty-string fallback (`??` where `||` was needed) was also found this way, caused by the new `ARG NEXT_PUBLIC_BUILD_SHA=""`.

## Decision log (local)

| Date | Decision | Rationale |
|---|---|---|
| 2026-05-01 | `worker` service pinned to `replicas: 1` | Backstop for pg-boss singleton schedules (alert eval, partman); guarantees no overlap even mid-restart |
| 2026-05-01 | Worker health-touch lives in the worker process, not in an entrypoint shell loop | Single source of truth; if Node dies the file goes stale, which is exactly what the healthcheck should detect. Implemented in `core/worker/health-touch.ts`, called from `main.ts` |
| 2026-05-01 | `migrate` service receives same `env_file` as app | It needs `DATABASE_URL`. Still true, though the runner is now drizzle-orm's migrator rather than drizzle-kit |
| 2026-08-13 | Container port pinned to 3000; `npm run start`'s 80 is local-only | See the status-block note and PLAN.md §17 |
| 2026-08-13 | `NODE_ENV=production` baked into the image | Covers all three processes; the two plain-`node` ones have no framework to default it |
| 2026-08-13 | esbuild bundles with dependencies inlined, not `--packages=external` | Relying on Next's file trace to include a worker-only dependency fails at runtime in production with no build-time signal |
| 2026-08-13 | drizzle-orm's migrator instead of `drizzle-kit migrate` | Keeps dev dependencies out of the runtime image; same journal table, so interchangeable |
| 2026-08-13 | Restore drops and recreates the database | `pg_restore --clean` cannot drop the inherited primary keys on `events` partitions |
| 2026-08-13 | `name: logger-prod` on the production compose file only | Prevents the prod stack adopting the dev Postgres container and data volume; leaving the dev file unnamed keeps existing checkouts' volumes |
| 2026-08-13 | No `worker-entrypoint.sh` wrapper | Exec-form `command:` already makes Node PID 1 and delivers SIGTERM directly; the wrapper's stated purpose was already satisfied |
| 2026-08-13 | Image size target revised from `< 250 MB` to `< 350 MB` | The original was set without measuring; the Node 22 binary alone is 123 MB |
