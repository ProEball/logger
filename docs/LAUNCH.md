# Launch checklist

Getting Logger from "builds and runs locally" to "serving real traffic on a real
domain". Written 2026-08-13, immediately after Feature 08.

[`OPERATIONS.md`](OPERATIONS.md) is the day-to-day runbook — how to deploy,
restore, read logs. **This** file is the one-time path to the first deploy: what
to buy, in what order, and what breaks if you skip a step.

Phases are ordered by dependency. Phase 4 needs Phase 1's domain; Phase 6 needs
almost everything before it.

---

## Phase 0 — Four decisions

Nothing can be bought until these are settled. Recommendations are given with
reasoning; all four are reversible except the domain.

### 0.1 Where it runs

The app is a single Docker host. It does not need Kubernetes, a managed
database, or a load balancer, and adding any of them multiplies cost without
buying anything at this scale.

**Sizing**, from PLAN.md §15.2's projection of ~1M events/day at 30-day
retention:

| Resource | Minimum | Comfortable | Why |
|---|---|---|---|
| vCPU | 2 | 4 | Postgres + app + worker on one box; ingest is insert-heavy |
| RAM | 4 GB | 8 GB | Postgres wants ~25% for `shared_buffers`; dashboard aggregations scan partitions |
| Disk | 80 GB | 160 GB SSD | ~22 GB database + ~15 GB local backups + images, logs, headroom |

| Option | Roughly | Notes |
|---|---|---|
| **Hetzner Cloud** | cheapest of the three by a wide margin | Best price/performance for exactly this shape of workload. EU/US locations. **Recommended** unless something below overrides it |
| **DigitalOcean** | ~3–4× Hetzner for equivalent specs | Better docs, friendlier console, one-click Docker image. Worth the premium if you want to spend zero time on the host |
| **Azure** | most expensive | Only if there is an organisational reason — existing tenant, billing, compliance. Nothing in this app benefits from it |

> Prices move; verify current figures before committing. The *ordering* above is
> stable, the numbers are not.

Skip anything "serverless" or PaaS: the app is deliberately stateful (local
Postgres, a Docker volume for backups, Caddy's certificate store) and every
managed platform charges to undo that.

- [ ] Provider chosen
- [ ] Region chosen — put it near your users, not near you. Latency on ingest matters more than on the dashboard

### 0.2 Domain and DNS

- [ ] Registrar chosen. **Cloudflare Registrar** sells at cost with no renewal
      markup and no upsell; Porkbun and Namecheap are fine. Avoid registrars
      that price year one at $1 and year two at $40.
- [ ] DNS host chosen. Cloudflare's free tier is the default answer even if the
      domain is registered elsewhere.

> ⚠️ **Start with the Cloudflare proxy OFF** (grey cloud, "DNS only"). With the
> orange cloud on, Cloudflare terminates TLS itself, which interferes with
> Caddy's ACME challenge and puts a second TLS layer in front of an app that
> already handles its own. Turn it on later, deliberately, with SSL mode set to
> **Full (strict)** — never "Flexible", which produces redirect loops.

### 0.3 Transactional email

This is blocker #1 in [`PROGRESS.md`](PROGRESS.md): `sendResetPassword` writes
the reset URL to the log instead of sending it. Until it is fixed, a user who
forgets their password cannot recover without an operator reading
`docker compose logs app`.

- [ ] Provider chosen — **Resend** or **Postmark** for a small install; **AWS
      SES** if you are already in AWS and don't mind the sandbox-exit request.
      All have free or near-free tiers at this volume.
- [ ] Do **not** self-host SMTP. Deliverability from a fresh VPS IP is
      effectively zero, and a password-reset mail in spam is the same as no mail.

### 0.4 Offsite backup target

Local backups sit in a Docker volume **on the same disk as the database**. A
dead server loses both. Offsite is not a nice-to-have; it is the actual backup.

- [ ] Bucket chosen — Backblaze B2 or Cloudflare R2. Both are S3-compatible and
      cheap at a few GB (~5 GB compressed per dump, per PLAN.md §15.2).
- [ ] Lifecycle rule planned. `scripts/backup.sh` never deletes anything remote
      by design — retention in the bucket is the bucket's job.

---

## Phase 1 — Domain

- [ ] Buy the domain
- [ ] Point it at your DNS host (Cloudflare nameservers, if that's the choice)
- [ ] Decide the hostname: apex (`logger.example.com`) or a subdomain of
      something you already own. Either works; `DOMAIN` in `.env` must match
      exactly, and Caddy issues a certificate for exactly that name

---

## Phase 2 — Server

- [ ] Create the instance. **Ubuntu LTS** or **Debian stable** — the Docker
      packages and every troubleshooting answer you'll search for assume one of
      those
- [ ] Add your SSH public key **at creation time**, so password auth is never
      enabled even briefly
- [ ] Note the IPv4 (and IPv6, if provided) address
- [ ] Add swap if RAM is 4 GB — 2 GB of swap costs nothing and prevents an OOM
      kill during a Postgres vacuum or a burst of ingest

---

## Phase 3 — Harden the host

Do this before anything listens on a public port.

- [ ] Create a non-root user, add it to the `docker` group, and disable root SSH
- [ ] `PasswordAuthentication no` in `sshd_config`, then reload sshd. Confirm
      you can still log in **from a second terminal** before closing the first
- [ ] Firewall — only three ports:
  - `22` SSH
  - `80` HTTP — ⚠️ **required even for an HTTPS-only site.** Let's Encrypt's
    HTTP-01 challenge reaches the host on 80. Closing it means no certificate
  - `443` HTTPS
  - Nothing else. Postgres is deliberately unpublished in `docker-compose.yml`
    and reachable only on the compose network
- [ ] `fail2ban` for SSH
- [ ] Unattended security upgrades
- [ ] Verify NTP is running. Partition boundaries, cron schedules and alert
      evaluation all key off timestamps; a drifting clock produces symptoms
      nobody connects back to the clock
- [ ] Install Docker Engine + the Compose plugin (**not** the `docker.io`
      distro package, which lags badly)
- [ ] ⚠️ **Configure Docker log rotation.** The default `json-file` driver has
      **no size limit**. This app emits a pino line per notable event plus JSON
      access logs from Caddy — on a busy install that fills the disk, and a full
      disk takes Postgres down with it. Put this in `/etc/docker/daemon.json`
      before the first deploy:
      ```json
      {
        "log-driver": "json-file",
        "log-opts": { "max-size": "50m", "max-file": "5" }
      }
      ```
      then `systemctl restart docker`. It applies to containers created after
      the restart, not existing ones.

---

## Phase 4 — DNS records

- [ ] `A` record → server IPv4. `AAAA` → IPv6 if the server has one
- [ ] Proxy **off** (grey cloud) for now — see 0.2
- [ ] TTL low (300s) until the deploy is proven, then raise it
- [ ] Wait for propagation and confirm from **outside** your network:
      `dig +short logger.example.com`. Caddy validates over public DNS, so your
      laptop's resolver cache proves nothing
- [ ] Email authentication records, from your provider's dashboard: **SPF**,
      **DKIM**, and a **DMARC** record. Without these, reset mails land in spam,
      which is indistinguishable from the bug you're fixing

---

## Phase 5 — Close the app-side gaps

Ordered by how much they hurt if skipped.

- [ ] **Implement password-reset email** (`core/auth/config.ts`). Blocker #1.
      Needs the provider from 0.3 and a new env var for the API key — which
      means the schema in `core/env/index.ts`, `.env.example`,
      `.env.production.example`, `docs/reference/stack.md`, per WORKFLOW.md §1
- [ ] **Do a certificate dry run.** The single riskiest untested step: local
      testing used `DOMAIN=:80`, which skips ACME entirely. Either deploy to the
      real domain early and watch `docker compose logs proxy`, or use a
      throwaway subdomain first. Let's Encrypt rate-limits failed attempts, so
      failing here on launch day is expensive
- [ ] **Run one real offsite backup cycle** with `OFFSITE=true` against the
      actual bucket, then restore from the downloaded copy. Only the failure
      paths have been exercised so far
- [ ] **Test the update path** on the server before you need it: deploy, tag a
      release, `docker compose pull && up -d`, confirm the app comes back.
      Untested today — `migrate` runs while the old `app` container is still
      serving, so a migration must stay compatible with the previous build for
      the length of the deploy
- [ ] Generate a real `AUTH_SECRET` (`openssl rand -base64 32`) and a strong
      `POSTGRES_PASSWORD`. Never reuse the values from any example file

---

## Phase 6 — First deploy

Follow [`OPERATIONS.md`](OPERATIONS.md#first-deployment). Two things that file
assumes you already know:

- [ ] `.env` goes **next to `docker-compose.yml`**, mode 600. Compose reads it
      twice and `--env-file` only covers one of those uses
- [ ] `APP_URL` must match `DOMAIN` including the scheme. A wrong value breaks
      invitation links and alert webhook deep links, and breaks them silently

> ⚠️ **Complete the setup wizard immediately — before sharing the URL.**
> Until the first user exists, every route redirects to `/setup`, and `/setup`
> is public by design. Whoever reaches it first becomes the organisation owner.
> The window between "DNS resolves" and "you finish the form" is a window in
> which a stranger can claim your install. Ideally, restrict port 443 to your
> own IP for the first few minutes, or finish setup within seconds of the app
> reporting healthy.

- [ ] `docker compose up -d`, watch `migrate` exit 0
- [ ] Complete `/setup`
- [ ] Create the first project and API key
- [ ] Send a test event with the curl snippet from the README; confirm it
      appears on the events page
- [ ] Create an alert rule with a webhook and confirm delivery

---

## Phase 7 — Prove it works

- [ ] `curl https://<DOMAIN>/api/health/ready` → 200, every check `ok`
- [ ] Certificate is valid and from Let's Encrypt, not self-signed
- [ ] HTTP redirects to HTTPS
- [ ] `docker compose ps` — all services healthy
- [ ] Reboot the server. Everything must come back on its own; `restart:
      unless-stopped` is only a claim until it has been tested once
- [ ] Force a backup (`docker compose restart backup`), confirm the dump appears
      locally **and** in the bucket
- [ ] Restore that dump into a scratch database and confirm it is complete. An
      unverified backup is not a backup

---

## Phase 8 — After launch

- [ ] **External uptime monitoring.** UptimeRobot, Better Stack, or a cron on a
      different machine hitting `/api/health/ready`. It must live outside this
      server — the app cannot tell you it is down
- [ ] **Disk-space alerting.** The most likely way this install dies is a full
      disk: 30 days of partitions, three local dumps, and Docker logs all grow
- [ ] Calendar reminder: **restore drill quarterly**. Backups rot silently
- [ ] Consider enabling the Cloudflare proxy now (orange cloud, SSL **Full
      (strict)**) for DDoS protection — deliberately, and with a health check
      immediately afterwards
- [ ] Revisit the [known gaps](PROGRESS.md#known-gaps-not-blockers): auth-endpoint
      rate limiting, `retention_days` enforcement, secret rotation, backup
      encryption

---

## Rough running cost

| Item | Per month |
|---|---|
| Server (4 vCPU / 8 GB / 160 GB) | $10–50 depending on provider |
| Domain | ~$1 (≈$10–15/year) |
| Transactional email | $0 at this volume on most free tiers |
| Object storage for backups | $1–6 for a few GB |

**$15–60/month**, dominated by the server choice. Verify current pricing — these
are estimates, not quotes.

---

## What this app does *not* need

Worth stating, because the default instinct is to add all of it:

- **Kubernetes** — one host, one replica, no autoscaling story. Adds a full-time
  operational surface for nothing
- **A managed Postgres** — the schema needs `pg_partman`, which most managed
  offerings do not install. This would be a migration, not a simplification
- **A CDN** — every route is server-rendered on demand because of the CSP nonce
  (see `docs/reference/misc.md`). There is nothing static to cache
- **Redis** — the only thing that would use it is the ingest rate limiter, and
  only once there is more than one `app` replica
- **A second app replica** — the in-memory rate limiter makes that actively
  wrong today, and one instance handles the projected load
