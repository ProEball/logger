# 08. Docker packaging

## Status
- [ ] Not started · [ ] In progress · [ ] Done
- Started: —
- Completed: —
- Last touched: 2026-05-01 (planning)
- Progress: 0 / 30 checklist items

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
- [ ] 1. `Dockerfile` with three stages:
  - `deps`: `npm ci --omit=dev` (production-only deps)
  - `builder`: `npm ci`, `npm run build`
  - `runner`: `node:20-alpine`, copy `.next/standalone`, copy `.next/static`, copy `public`, copy worker bundle, run as non-root user.
- [ ] 2. Set `next.config.ts: { output: 'standalone' }`.
- [ ] 3. `.dockerignore` excludes `node_modules`, `.next`, `e2e`, `tests`, `docs`, `.git`, etc.
- [ ] 4. Build worker bundle: extend Next.js build with a separate esbuild step OR include `worker.ts` source and run via `tsx`/`ts-node` in container. Decision: use **esbuild standalone bundle** during build stage for performance.
- [ ] 5. Live check: `docker build .` succeeds. Image size < 250 MB.

### Worker entrypoint
- [ ] 6. `worker.ts` — see "Worker entrypoint" above. Includes the health-touch interval inline.
- [ ] 7. `scripts/worker-entrypoint.sh` — thin wrapper: `exec node dist/worker.js` (so SIGTERM reaches the Node process). Does NOT do its own health-touch — the worker itself owns it. If the worker process dies the file goes stale and the healthcheck fails, which is exactly the desired behavior.
- [ ] 8. Live check: build image with worker entrypoint, run container, verify pg-boss connects and `/tmp/worker-alive` is fresh. Kill the Node process inside the container → mtime stops advancing → healthcheck flips to unhealthy within ~60s.

### Migration init container
- [ ] 9. `scripts/migrate-entrypoint.sh` — runs `npx drizzle-kit migrate`, exits 0/non-0 based on result.
- [ ] 10. Compose service `migrate` uses the same image with this entrypoint, `restart: 'no'`.
- [ ] 11. `app` and `worker` services declare `depends_on: { migrate: { condition: service_completed_successfully } }`.

### Caddyfile
- [ ] 12. `Caddyfile` with `{$DOMAIN}` placeholder (compose substitutes from env). `reverse_proxy app:3000`. Health endpoint exposed.
- [ ] 13. Volumes: `caddy_data` (certificates), `caddy_config`. Persistent across restarts.

### Production compose
- [ ] 14. `docker-compose.yml` (production) — services: `proxy`, `app`, `worker`, `postgres`, `migrate`, `backup`.
  - `app` depends on migrate (completed) + postgres (healthy).
  - `worker` same.
  - `proxy` depends on `app`.
  - `backup` depends on `postgres` (healthy).
  - **`worker` service: `deploy.replicas: 1`** — backstop for the pg-boss singleton schedules (alert evaluator, partman maintenance). pg-boss `singletonKey` already prevents double execution at the queue level, but pinning replicas to 1 also prevents the brief overlap window during a `compose up -d` rolling restart.
  - `migrate` runs the migration entrypoint and exits 0; `app` and `worker` declare `depends_on: { migrate: { condition: service_completed_successfully } }`. `migrate` requires `env_file` with `DATABASE_URL` (drizzle-kit needs it).
- [ ] 15. Health probes per service:
  - `app`: `wget -qO- http://localhost:3000/api/health/ready` interval 30s
  - `postgres`: `pg_isready -U $POSTGRES_USER` interval 10s
  - `proxy`: `wget http://localhost:2019/config/` (Caddy admin) or static page
  - `worker`: `[ -n "$(find /tmp/worker-alive -mmin -1)" ]` — file alive within last minute. Touched by the worker process itself (see step 6).
- [ ] 16. Restart policy `unless-stopped` for app, worker, postgres, proxy. `no` for migrate. `unless-stopped` for backup.

### Backup script (prod-only)
- [ ] 17. `scripts/backup.sh`:
  - `BACKUP_INTERVAL_HOURS` (default 24)
  - `BACKUP_RETENTION_COUNT` (default 3)
  - `RCLONE_REMOTE` (e.g. `b2:logger-backups/<host>`) — required if offsite enabled, optional if `OFFSITE=false`
  - Loop: `pg_dump -Fc` → file `backups/$(date +%Y%m%d-%H%M%S).dump` → rotate (keep newest N) → `rclone copy` to offsite (if configured) → sleep `INTERVAL_HOURS * 3600`
- [ ] 18. Local rotation: `ls -1t backups/*.dump | tail -n +$((COUNT+1)) | xargs -r rm`
- [ ] 19. Backup on first start: run once immediately, then enter sleep loop (don't wait 24h for first backup).
- [ ] 20. Live check (prod compose only): `docker compose up -d backup` → file appears in mounted volume → verify `pg_restore --list` reads it.

### Restore script
- [ ] 21. `scripts/restore.sh <dumpfile>` — drops + recreates DB, runs `pg_restore`. Asks confirmation. Documented in `docs/OPERATIONS.md`.

### .env.production.example
- [ ] 22. Document all env vars:
  ```
  # Domain
  DOMAIN=logger.example.com
  
  # Database
  POSTGRES_DB=logger
  POSTGRES_USER=logger
  POSTGRES_PASSWORD=change-me
  DATABASE_URL=postgres://logger:change-me@postgres:5432/logger
  
  # Auth
  AUTH_SECRET=                 # generate: openssl rand -base64 32
  
  # Backups (set to false to disable offsite)
  OFFSITE=true
  BACKUP_INTERVAL_HOURS=24
  BACKUP_RETENTION_COUNT=3
  RCLONE_CONFIG=/config/rclone.conf
  RCLONE_REMOTE=b2:logger-backups/<host>
  
  # Worker
  ALERTS_WORKER_ENABLED=true
  
  # Build metadata (set during build)
  NEXT_PUBLIC_BUILD_SHA=
  NEXT_PUBLIC_BUILD_TIME=
  ```
- [ ] 23. Document conventions: env file at `/etc/logger/.env`, mode 600, owner = docker user.

### Documentation
- [ ] 24. `docs/OPERATIONS.md` covering:
  - First deployment (clone, env setup, `docker compose up -d`, watch migrate exit 0, app boots)
  - Updating to new version (pull new image, recreate)
  - Backup verification (manual `pg_restore --list`)
  - Restore procedure (`scripts/restore.sh`)
  - Log inspection (`docker logs app`, `docker logs worker`)
  - Health endpoint check
  - Caddy cert troubleshooting
- [ ] 25. README links to OPERATIONS.md.

### Build & publish
- [ ] 26. GitHub Actions workflow `release.yml`: on tag `v*`, build image, push to ghcr.io, attach release notes.
- [ ] 27. Tag image with: version, `latest`, git SHA. Build args set `NEXT_PUBLIC_BUILD_SHA` and `NEXT_PUBLIC_BUILD_TIME`.

### Final verification
- [ ] 28. End-to-end on a clean VPS or local fresh Docker:
  - Clone repo, copy `.env.production.example` → `.env`, edit
  - `docker compose up -d`
  - Wait for migrate to exit 0
  - Open `https://logger.example.com` (or `http://localhost` for local test) → setup wizard
  - Create org, project, API key
  - Send test event via curl
  - Open events page, see event
  - Trigger an alert rule, see webhook
  - Force backup: `docker compose exec backup /scripts/backup.sh`
  - Verify file in volume + offsite
- [ ] 29. Update PROGRESS.md → ✅ Done.
- [ ] 30. Update Status block.

## Live check (full)

See step 28 above — full deployment scenario.

## Tests

- CI (`docker build`) verifies image builds cleanly.
- Smoke E2E run against compose stack (optional in CI; complex setup).
- Manual: deployment to a staging host before each release.

## Open questions

- ❓ GitHub Actions workflow — where to host built image? `ghcr.io` if public repo, otherwise private registry. Decide before first release.
- ❓ Rate limiter is single-instance. If app needs to scale to N replicas, switch to Redis-backed limiter. Document as known limitation.

## Decision log (local)

| Date | Decision | Rationale |
|---|---|---|
| 2026-05-01 | `worker` service pinned to `replicas: 1` | Backstop for pg-boss singleton schedules (alert eval, partman); guarantees no overlap even mid-restart |
| 2026-05-01 | Worker health-touch lives in `worker.ts`, not in entrypoint shell loop | Single source of truth; if Node dies the file goes stale, which is exactly what the healthcheck should detect |
| 2026-05-01 | `migrate` service receives same `env_file` as app | drizzle-kit migrate needs `DATABASE_URL` |
