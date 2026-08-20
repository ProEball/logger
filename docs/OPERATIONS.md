# Operations

Deploying and running Logger in production. For "what the code does", see
[`docs/reference/`](reference/README.md); for local development, see
[`reference/stack.md`](reference/stack.md#local-development-environment).

Everything here was exercised against the real stack on 2026-08-13 unless a
section says otherwise.

---

## What runs

Six containers, defined in `docker-compose.yml`:

| Service | Image | Role |
|---|---|---|
| `proxy` | `caddy:2-alpine` | TLS termination, automatic Let's Encrypt, reverse proxy to `app` |
| `app` | built from `Dockerfile` | Next.js standalone server, listens on **3000** inside the container |
| `worker` | same image, `node worker.js` | pg-boss job runner — alert evaluation, alert delivery, partition maintenance |
| `migrate` | same image, `node migrate.js` | One-shot. Applies migrations, exits 0, gates `app` and `worker` |
| `postgres` | built from `db/Dockerfile` | Postgres 16 + pg_partman. Not published to the host |
| `backup` | built from `db/backup.Dockerfile` | `pg_dump` loop with rotation and optional offsite copy |

`app`, `worker` and `migrate` are **the same image with different commands**, so
all three always run the same application code.

Boot order is enforced by compose, not by chance: `postgres` healthy →
`migrate` exits 0 → `app` and `worker` start → `proxy` starts once `app` is
healthy.

> **Port 3000, not 80.** The container runs `.next/standalone/server.js`, which
> reads `PORT` from the environment (baked into the image as 3000). It never
> runs `next start`, so the `-p 80` in `npm run dev` / `npm run start` — which
> governs local development only — does not apply. Three places must agree if
> you change it: `ENV PORT` in the `Dockerfile`, `reverse_proxy app:3000` in
> the `Caddyfile`, and `PORT` in `.env` (used by the compose healthcheck).

---

## First deployment

Requirements on the host: Docker with the Compose plugin, ports 80 and 443
free, and a DNS A/AAAA record for your domain already pointing at the host.
Caddy validates over HTTP, so the record must resolve *before* the first start
or certificate issuance fails.

```bash
git clone <repo> /opt/logger
cd /opt/logger
cp .env.production.example .env
chmod 600 .env
```

Edit `.env`. At minimum set `DOMAIN`, `APP_URL`, `POSTGRES_PASSWORD`,
`DATABASE_URL` (same password), and generate `AUTH_SECRET`:

```bash
openssl rand -base64 32
```

Keep the file named `.env` next to `docker-compose.yml`. Compose reads it twice
and both matter: for `${VAR}` substitution inside the compose file itself
(`DOMAIN`, `POSTGRES_*`, `PORT`) and for the variables injected into containers
via `env_file`. `--env-file` elsewhere covers only the second.

Then:

```bash
docker compose up -d
```

Watch it come up:

```bash
docker compose logs -f migrate     # expect "migrations applied", then exit 0
docker compose ps                  # app, worker, postgres, proxy all (healthy)
```

Open `https://<DOMAIN>`. With no users in the database every route redirects to
`/setup`, which creates the first organization and its owner. That redirect is
the app working correctly, not an error.

### Verifying the deployment

```bash
curl -s https://<DOMAIN>/api/health/ready | jq
curl -s https://<DOMAIN>/api/version | jq
```

`/api/health/ready` returns 200 with every check `ok`, or 503 if the database
is unreachable or migrations are behind. Two entries are informational and do
**not** fail the probe:

- `pgboss: "not_running_in_process"` — correct in production. The worker is its
  own container, so the app process has no in-process pg-boss to report on.
- `ingest: "stale"` — no events received in the last hour. Expected on a fresh
  install; it also surfaces as an `X-Health-Warn` response header.

---

## Updating

### From a published image (recommended)

Tagging a release (`git tag v0.2.0 && git push origin v0.2.0`) runs
`.github/workflows/release.yml`, which publishes to
`ghcr.io/<owner>/logger`. On the host, point `IMAGE` in `.env` at the new tag:

```bash
IMAGE=ghcr.io/<owner>/logger:0.2.0
```

> **The image tag has no `v`.** `docker/metadata-action` is configured with
> `type=semver,pattern={{version}}`, which strips it: git tag `v0.2.0` publishes
> image tag `0.2.0`. This line said `:v0.2.0` until 2026-08-20 and cost a
> `manifest unknown` during the first real deploy. Check the package listing on
> GHCR if in doubt — it shows the tags that actually exist.

```bash
docker compose pull
docker compose up -d
```

`migrate` re-runs on every `up`, applies anything new, and exits 0 — `app` and
`worker` do not start until it does.

> **`git pull` first if the release touches anything outside the app image.**
> `docker compose pull` fetches images; it does not update the files on the
> host. `docker-compose.yml`, the `Caddyfile`, `db/Dockerfile` and `db/init/`
> are read from the checkout at `/opt/logger`, and `postgres` and `backup` are
> **built locally** — `docker compose config --images` shows them as
> `logger-prod-postgres` and `logger-prod-backup` rather than registry
> references.
>
> Skipping it fails in a way that does not look like a stale file: the new
> containers start against the old compose definition, and whatever the release
> added there is simply absent. Check with
> `git diff --name-only <old-tag>..<new-tag> -- docker-compose.yml Caddyfile db/`
> and `git pull` when it prints anything. Rebuild only if `db/Dockerfile` or
> `db/backup.Dockerfile` is among them.

### Deploying the read-path release (2026-08-20)

Four things about this particular update are worth knowing before running it.

**It needs `git pull` on the host.** The release changes `docker-compose.yml`
(the `command:` for Postgres) and `db/init/01-extensions.sql`, neither of which
travels in the app image. `db/Dockerfile` is untouched, so nothing needs
rebuilding. Order: `git pull`, then set `IMAGE`, then `docker compose pull &&
docker compose up -d`.

**Postgres is recreated, not just restarted.** `docker-compose.yml` now passes a
`command:` (for `shared_preload_libraries=pg_stat_statements` and the tuning
knobs), so `docker compose up -d` replaces the container. The named volume
carries the data across; the outage is the length of one Postgres start.

**`pg_stat_statements` needs one manual step on an existing install.**
`db/init/01-extensions.sql` only runs against an empty data directory, so:

```bash
docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "CREATE EXTENSION IF NOT EXISTS pg_stat_statements"'
```

**The rollup builds in the background, not during migration.** Migration 0008
seeds each project's watermark at its oldest event and leaves `rolled_up_to`
NULL, which readers treat as "nothing rolled up yet" and answer entirely from
`events` — so the deploy is safe before the job has ever run. The `event-rollup`
job then catches up **one day of history per run**, once a minute. Watch it
finish:

```bash
docker compose exec postgres sh -c \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT project_id, refresh_from, rolled_up_to FROM rollup_state"'
```

`rolled_up_to` advancing to within a minute or two of now means the backfill is
done. It requires the `worker` service to be running — without it the rollup
never builds and the dashboards silently keep reading raw events.

### Building on the host

```bash
git pull
docker compose build
docker compose up -d
```

Slower and it puts a build toolchain on the production host, but it needs no
registry. `/api/version` will report `sha: "dev"` unless you pass
`NEXT_PUBLIC_BUILD_SHA` / `NEXT_PUBLIC_BUILD_TIME` as build args — they are
inlined at build time and cannot be set afterwards in `.env`.

### Rolling back

Set `IMAGE` back to the previous tag and `docker compose up -d`. **Migrations
do not roll back.** A previous image runs fine against a database migrated by
its successor as long as no migration dropped or renamed something the older
build reads — check the migration diff before relying on this.

---

## Backups

The `backup` container dumps immediately on start, then every
`BACKUP_INTERVAL_HOURS` (default 24). Dumps go to the `backups` volume as
`YYYYMMDD-HHMMSS.dump` (`pg_dump -Fc`), keeping the newest
`BACKUP_RETENTION_COUNT` (default 3).

```bash
docker compose logs backup                      # one line per dump and rotation
docker compose exec backup ls -lh /backups
```

### Force a backup now

```bash
docker compose restart backup
```

The loop takes its first dump on startup, so a restart is a manual trigger.

### Verify a backup is restorable

Reading the archive's table of contents proves it is complete and not
truncated. Do this after changing anything about backups — a dump that cannot
be listed cannot be restored either.

```bash
docker compose exec backup sh -c 'pg_restore --list /backups/$(ls -1t /backups | head -1)' | head
```

### Offsite copies

Set `OFFSITE=true` and `RCLONE_REMOTE` in `.env`, plus rclone's own
`RCLONE_CONFIG_<REMOTE>_*` variables (examples in
`.env.production.example`). The container refuses to start if `OFFSITE=true`
without a remote, rather than silently skipping uploads.

Retention in the bucket is the bucket's job — configure lifecycle rules there.
The script never deletes anything remote.

A failed upload is logged and the local copy is kept; the next cycle retries.
Watch for `rclone copy … failed` in `docker compose logs backup`.

---

## Restoring

**Destructive.** The target database is dropped and recreated. Everything
written after the chosen dump is lost.

```bash
# 1. Stop everything that writes to the database.
docker compose stop app worker

# 2. Pick a dump.
docker compose exec backup ls -lt /backups

# 3. Restore. Type the database name when prompted.
docker compose exec backup sh /scripts/restore.sh /backups/20260813-030000.dump

# 4. Bring the app back.
docker compose up -d app worker
curl -s https://<DOMAIN>/api/health/ready | jq
```

The script refuses to touch the database unless `pg_restore --list` can read
the archive first — restoring a truncated dump onto a wiped database is the one
unrecoverable mistake available here.

For unattended disaster recovery, set `RESTORE_YES=true` to skip the prompt.
Nothing else about the run changes.

> **Why drop-and-recreate rather than `pg_restore --clean`:** `events` is
> declaratively partitioned, and each partition's primary key is an *inherited*
> constraint that Postgres refuses to drop directly. `--clean` aborts partway
> through with `cannot drop inherited constraint "events_pYYYYMMDD_pkey"`,
> leaving the restore half-applied. Restoring into an empty database avoids the
> problem entirely; the dump carries the `drizzle` and `pgboss` schemas and the
> `pg_partman` extension, so nothing needs recreating by hand.

---

## Logs

Everything logs JSON to stdout and Docker captures it. There is no log shipper.

```bash
docker compose logs -f app
docker compose logs -f worker
docker compose logs --since 1h --tail 200 app
docker compose logs proxy            # Caddy access logs, also JSON
```

Useful filters:

```bash
docker compose logs worker | grep '"level":50'          # errors
docker compose logs app | grep 'slow query'             # queries over 500ms
```

Set `LOG_LEVEL=debug` in `.env` and `docker compose up -d app worker` to raise
verbosity. Put it back afterwards — `debug` is noisy under ingest load.

---

## Health and monitoring

| Check | Command |
|---|---|
| All containers | `docker compose ps` |
| App readiness | `curl -s https://<DOMAIN>/api/health/ready` |
| App liveness | `curl -s https://<DOMAIN>/api/health` |
| Build identity | `curl -s https://<DOMAIN>/api/version` |
| Worker | `docker inspect --format '{{.State.Health.Status}}' $(docker compose ps -q worker)` |

The worker has no HTTP surface. It advances the mtime of `/tmp/worker-alive`
every 30 seconds from inside the Node process, and its healthcheck asserts the
file changed within the last minute. The touch deliberately lives in the worker
itself rather than in a wrapper script: if Node dies or wedges, the file goes
stale and the container is marked unhealthy. A shell loop would keep reporting
healthy over a corpse.

To confirm the mechanism by hand:

```bash
docker compose exec worker sh -c 'ls -l /tmp/worker-alive'
docker compose exec worker sh -c 'test -n "$(find /tmp/worker-alive -mmin -1)"; echo $?'   # 0 = alive
```

Logger can also watch itself — point an alert rule's webhook at an external
receiver so a dead app is reported from outside. See the README's monitoring
section.

---

## Certificates

Caddy provisions and renews certificates automatically, storing them in the
`caddy_data` volume. **Do not delete that volume casually** — reissuing counts
against Let's Encrypt's per-domain rate limits (5 duplicate certificates per
week).

```bash
docker compose logs proxy | grep -i "certificate\|acme\|obtain"
```

Common failures:

| Symptom | Cause |
|---|---|
| `no such host` / NXDOMAIN | DNS does not resolve to this host yet. Fix DNS, then `docker compose restart proxy` |
| Timeout during the HTTP challenge | Port 80 blocked upstream. Let's Encrypt must reach the host on 80 even for an HTTPS-only site |
| `too many certificates already issued` | Rate limited. Wait, and use `DOMAIN=:80` for local testing rather than burning real issuances |
| Certificate works but the app 502s | Caddy is fine, `app` is not. `docker compose logs app` |

For a local test with no public DNS, set `DOMAIN=:80`. Caddy then serves plain
HTTP and skips ACME entirely.

### Do not add security headers to the Caddyfile

The app emits the whole set itself, including a `Content-Security-Policy`
minted per request with a fresh nonce. A browser enforces *every* CSP header it
receives, and the proxy cannot know the request's nonce — so any policy added
in Caddy blocks exactly the nonced inline scripts Next uses to boot the client.
The symptom is a page that renders but is completely inert. The `Caddyfile` has
a longer note at the point of temptation.

---

## Operational notes and known limits

- **The dev and production stacks are separate compose projects.**
  `docker-compose.yml` declares `name: logger-prod`; the dev file keeps the
  default (`logger`). Without that, running the production file in a developer
  checkout recreates the dev Postgres container and points production at the
  dev data volume.
- **Postgres is not published to the host.** Use
  `docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'`. The `sh -c` wrapper is not decoration: `$POSTGRES_USER` lives in `.env`, which Docker Compose reads for the container and your shell does not, so expanding it outside sends an empty `-U` and psql falls back to the OS user — `FATAL: role "root" does not exist`.
  Adding a `ports:` entry would expose it to the internet on most VPS firewall
  setups.
- **`worker` is pinned to one replica.** pg-boss `singletonKey` already
  prevents double execution of the cron schedules; the pin also removes the
  overlap window during a restart.
- **The ingest rate limiter is per-process and in-memory.** Running more than
  one `app` replica multiplies the effective limit by the replica count. A
  shared store is required before scaling out.
- **`projects.retention_days` is not enforced.** Partition retention is
  globally fixed at 30 days in migration 0003. The column is read and exposed
  through the API but changing it has no effect.
- **Password reset does not send email.** `sendResetPassword` writes the reset
  URL to the application log. Recovering an account today means reading it out
  of `docker compose logs app`.
