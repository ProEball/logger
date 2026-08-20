# Progress

> Single source of truth for "where are we right now". Update after every work session.

**Last updated**: 2026-08-20 (staging run, read-path audit, §16.1 Stages B–D — rollup complete)

---

## Current Phase

**Read-path performance — [`PLAN.md` §16.1](PLAN.md#161-post-beta-workstream-read-path-performance).** The numbered roadmap features are all complete and the app is deployable (Feature 08, 30/30, live-checked 2026-08-13; deployment procedures in [`OPERATIONS.md`](OPERATIONS.md)). The staging run on 2026-08-19/20 then put real volume behind it for the first time, and the org overview came back at **1.4–1.6 s on 540k events** with the host at 8% CPU — so the cost is query and page structure, not resources. That opened the workstream.

**Stage B — tests for `features/overview/` — is under way.** First half landed 2026-08-20: the search-param parsing, chart bucket table and per-project row assembly were extracted out of `app/[org]/(org-shell)/page.tsx` and `OverviewPage.tsx` into `features/overview/utils/` and covered by 50 tests (441 total, up from 391). The extraction came first because the logic was in a route file, where §2.3 forbids it and where nothing could unit-test it — and because Stage D rewrites exactly that code.

**Second half landed the same day: `e2e/overview.spec.ts`, 17 tests** covering the KPI row, the project table (including a project with no events), top errors, level breakdown, and every filter. Writing it **found a real bug**: `COUNT(*)::text AS count` followed by `ORDER BY count DESC` binds to the text alias, so `"9"` sorted above `"10"` and "top 5 errors across org" returned the wrong five. Failing test first, then the fix, per WORKFLOW §2. Three more occurrences remain in the dashboard service — see the known gaps below.

**Stage B is closed.** The last piece — `overview.service.ts` itself — is covered by **38 integration tests** against a real Postgres (`npm run test:it`), on a new `logger_itest` database the harness creates, migrates and seeds itself. Verified from nothing: dropping the database and re-running rebuilds it and passes in ~1.2 s. Setup and rationale in [`reference/misc.md`](reference/misc.md#testing).

That suite found a **second bug**: an environment name containing a comma is split into two environments, because the query joins with `STRING_AGG(…, ',')` and the service splits the result on `","` — and ingest accepts a comma in `environment`. Pinned at the time rather than fixed, since it changed a shipped query; **fixed later the same day** as a side effect of moving the pills to the rollup, and the pinned test inverted.

**Test totals now:** 441 unit · 38 integration · 70 e2e. *(By the end of the day: 492 · 70 · 71.)*

**Stage C started 2026-08-20 — benchmark harness first.** `npm run bench` measures the real service functions against whatever `DATABASE_URL` points at, discovering its target at run time and reporting the corpus it chose; `npm run bench:seed` builds a 500k corpus in `logger_bench`. The stage's order was corrected in the plan: benchmark → baseline → one change at a time, not instrumentation first. `pg_stat_statements` and Postgres tuning are **not** started; both change the deployed image and the second needs the first.

**First baseline (local, 500k events, 168k distinct messages)** — `bench/baselines/2026-08-20-local-500k.json`:

| Query | mean |
|---|---|
| round-trip floor (`SELECT 1`) | 0.26 ms |
| `getOrgEventBuckets` (1h) | **99.6 ms** |
| `getProjectSummaries` (3 queries) | 56.2 ms |
| `getOrgEnvironments` (30-day scan) | 39.3 ms |
| `getOrgTopErrors` | 25.7 ms |
| `getOrgLevelBreakdown` | 14.1 ms |
| whole page fan-out | 106.4 ms |

**`pg_stat_statements` is enabled** (both compose files, `db/init/01-extensions.sql`) and produced the most useful result of the stage so far. Per page fan-out, all seven `events` queries have identical call counts — no N+1 — and the time splits like this:

| share | query |
|---|---|
| 30.7% | `getOrgEventBuckets` |
| **18.1%** | `STRING_AGG(DISTINCT environment)` inside `getProjectSummaries` |
| **13.4%** | `getOrgEnvironments` — the 30-day scan |
| 10.1% | `getOrgTopErrors` |
| 8.8% | per-project top message |
| 6.1% | per-project stats |
| 5.0% | `getOrgLevelBreakdown` |

**Environment enumeration is 31.5% of the page's database time, and it is paid twice** — once for the dropdown, once per project — for what is a list of two values. That is a *proportion*, so unlike every timing on this page it survives the move to different hardware. It makes the environments registry the best-evidenced item in Stage D.

**Postgres tuning is deliberately not done.** Both compose files now expose `PG_SHARED_BUFFERS`, `PG_WORK_MEM` and three more, defaulting to the stock values — the knob exists, nothing was turned. Choosing values needs a constrained host: a developer machine's page cache holds the entire 265 MB corpus, so every `shared_buffers` setting measures the same.

**Stage D item 1 done, 2026-08-20 — the environments registry.** `project_environments` (migration 0007, with a backfill) is maintained at ingest and replaces the 30-day scan of `events` behind the overview's filter bar. **39.3 ms → 0.67 ms**, and the query drops out of the page's cost list entirely; the remaining queries redistribute exactly as removing 13.4% predicts (buckets 30.7% → 37.6%, against 35.5% calculated). Page wall-clock went ~106 ms → ~92 ms, which is **inside the noise floor** — expected, because the query ran in parallel with slower ones. The honest claim is that database *work* fell, not that the page got faster. Baselines: `bench/baselines/2026-08-20-local-500k{,-after-env-registry}.json`.

Stage D was **reordered** on Stage C's evidence, with caching moved from first to last — reasons in `PLAN.md` §16.1 and §17. The per-project environment pills (`STRING_AGG(DISTINCT environment)`) were **not** covered at this point: 18.1% before, 23.8% after. They looked like they needed a product decision about what the pills mean — that turned out to be wrong, and they were closed by the rollup later the same day without any semantic change, because `by_env` is stored per minute and so can answer "environments in this range" exactly.

**Facet counts moved off the events page load, 2026-08-20.** Five aggregations used to run in the route's `Promise.all` on every load — including auto-refreshes — while `FiltersPopover` keeps its open state in client `useState`, so nobody could see them on the great majority of loads. They now load when the panel opens, through `getFacetCountsAction`. **A normal events page is one query**: a keyset page of 51 rows.

The action re-checks session and `events.read` — a Server Action is a public endpoint, and the page's own membership check does not cover it. It takes the page's query string and re-parses it with `parseFilters`, the same function the route uses, rather than carrying a second Zod schema for `EventFilters` that could drift from the first.

Reading through a Server Action departs from `PROJECT.md` §8 ("Server Actions for mutations; Server Components for reads"). Deliberate: the read is triggered by a client interaction the server cannot observe, and a route handler would mean re-implementing auth that an action gets for nothing.

New e2e covers it, and the test was verified to **fail** against a deliberately broken action before being kept — otherwise it would be one more test that passes on a broken page, which this suite already had too many of.

**Rollup table landed, 2026-08-20 — Stage D item 2, complete.** `event_rollup_minutes` (one row per `(project, minute)`, `by_level`/`by_env` as JSONB, `errors` a generated column) plus `rollup_state`, rebuilt every minute by the `event-rollup` pg-boss job. The volume chart, the level breakdown and the project summaries all read it; **everything keyed by message still reads `events`**, which is structural rather than unfinished.

Design points worth not re-deriving:

- **Reads union the rollup with a raw tail.** The rollup holds only closed minutes, so on its own every chart would be missing the newest minute — the one someone watching an incident cares about. `rollup_state.rolled_up_to` marks where the rollup is complete; below it comes from the rollup, above from `events`. `NULL` means "nothing built yet" and the read falls back entirely to `events`, which is what makes migration 0008 safe to deploy before the job has ever run.
- **Catch-up is capped at one day per run.** The migration seeds the watermark at each project's oldest event, so without a cap the first run would aggregate the whole table while the schedule kept firing.
- **Delete-then-insert, not upsert.** A minute whose events aged out has to lose its row; an upsert would leave a stale count that nothing would ever contradict.
- **Late events** are handled by the ingest path pulling the watermark back with `LEAST(refresh_from, oldest in batch)`. `events` stores when an event happened, not when it arrived, so no query on that table could work this out.

**Both increments are done.** `getOrgEventBuckets`, `getOrgLevelBreakdown` and `getProjectSummaries` all read the rollup; only the message-keyed queries still touch `events`.

Measured on the 500k local corpus:

| | fan-out | note |
|---|---|---|
| original | 106.4 ms | before any of this |
| after environments registry | ~94.5 ms | inside the noise floor |
| after rollup (buckets, levels) | 56.1 ms | |
| after rollup (project summaries) | **26.0 ms** | |

Individually: volume buckets **90.8 → 3.4 ms** (27×), level breakdown 14.1 → 6.7 ms, project summaries **57.5 → 24.1 ms**.

**The page is now bounded by `getOrgTopErrors`** — the one query that structurally cannot come from a rollup, since it is keyed by message. `EXPLAIN` locates its cost precisely: the `(project_id, level, timestamp)` index finds the rows in 0.35 ms, but fetching them costs **2,133 heap blocks for 2,785 rows** — about one random page per row, because errors are ~7% of events and scattered among the rest. So cost is proportional to matching rows, and the index is already optimal.

That leaves one lever: match fewer rows. **The widget's window is now capped at 24 h** independently of the page range (`clampTopErrorsWindow`), and it displays the period it covers. A 30-day page range used to drag this widget along with it; measured 23.2 ms over 72 h against 6.6 ms over 1 h, of which ~6 ms is fixed cost no window reduces.

Deliberately **not** a user-facing selector. That would buy the ability to choose a window — which nobody has asked for — at the price of a second time control on a page that already has one. The cap is a few lines and removes the cliff; a selector can follow a request that names the windows it needs.

`getProjectSummaries` keeps two paths: `by_level` answers a level filter, but an **environment** filter needs errors-per-environment — a joint the marginals do not hold — so that read still goes to `events`. Both paths are pinned against direct counts.

**The comma-in-environment bug is fixed as a side effect.** The pills come from JSON keys now, so there is no `STRING_AGG`/`split(",")` pair left to break them. The test that pinned the bug was inverted, not deleted — it failed the moment the fix landed, which is exactly what it was for. New divergence in its place, deliberate and tested: above the 20-environment cap the pill list is the top 20 plus `(other)`, not the raw `DISTINCT`.

**The raw tail costs about 0.3–0.6 µs per event in it**, and its width depends on how far behind the rollup is, not on the range being charted: 0.12 ms for a two-minute tail, 7.7 ms for a four-hour one. Steady state is at most a minute of ingest. A stalled job therefore degrades speed and not correctness — the worst case is the ~91 ms the query took before the rollup.

⚠️ The first attempt at this measurement was **meaningless and nearly reported as a win**: the benchmark builds the rollup immediately before measuring, so the boundary landed past the newest event and the tail was empty. "The tail is free" was measuring nothing at all. The bench now pushes the boundary back deliberately (`BENCH_TAIL_MINUTES`, default 2) to match production. Same class of error as benchmarking the environments registry against an unpopulated table.

Verification is mostly **agreement, not existence**: the integration tests compare rollup-backed reads against direct counts of `events` — total, per level, with and without a filter, and after a fresh insert that no rebuild has seen. 16 new integration tests, 65 in total.

**Auto-refresh** is now `off | 30s | 60s | 5m`. `10s` went for its **cost** — six page loads a minute per viewer, for a difference nobody acts on. It was first justified here as "the rollup only changes once a minute, so a faster refresh sees the same numbers"; that is **wrong**, and corrected on the spot: reads union the rollup with a raw tail, so freshness is not gated by the rebuild cadence at all. A stored `10s` is **translated to `30s`** rather than falling back to the default, which would have silently switched auto-refresh off for everyone who had chosen it.

⚠️ The same mistake reached two other claims and has been corrected in both: **"every viewer sees identical numbers" holds only below `rolled_up_to`.** The raw tail is computed per request, so the newest minute can still differ between two viewers by whatever arrived between their loads. The rollup turns "every figure may differ" into "only the newest minute may differ", which is the real, smaller claim.

**Streaming done, 2026-08-20 — Stage D item 3.** `app/[org]/(org-shell)/page.tsx` no longer awaits a `Promise.all` of every aggregation before rendering. It starts each query, passes the **promise** down, and `OverviewPage` is six independent `Suspense` boundaries: filter bar, KPI row, volume chart, projects panel, top errors, level breakdown.

Passing promises rather than letting each section fetch is the substance of it. Two sections need the bucket query and two need the summaries; a section-fetches-its-own design would have issued both **twice**, so a change made to speed the page up would have slowed it down. Verified with `pg_stat_statements` against `logger_test`: all six aggregations record identical call counts, including the bucket query that two sections await. It also keeps the cross-feature calls in the route, where §2.3 permits data loading, rather than importing `features/projects` and `features/alerts` into `features/overview` against §2.1.

The 17 overview e2e tests written earlier the same day passed unchanged — which is the return on having written them before the optimisation rather than after.

⚠️ **The benefit is not observable locally.** Every query returns in milliseconds against a developer machine, so there is nothing to stream. This pays off on the constrained host where the page measured 1.4 s, and it is not yet confirmed there.

**Widget inventory written before designing the rollup** — [`reference/widgets.md`](reference/widgets.md), registered as a help-centre category so it is readable in the app. Every read surface across the overview, the project dashboard and the events page: which query backs it, what it groups by, which filters it responds to, its measured share, and whether a rollup could serve it.

Three things it turned up that reading two widgets would not have:

- **`release` is the dimension that must never enter a rollup.** Environment cardinality was the risk everyone saw; a release identifier is *designed* to change on every deploy, so it is strictly worse and far less obvious. The releases facet stays on raw events.
- **`EnvironmentBreakdownWidget` and `environmentBreakdown()` are dead code** — rendered nowhere, called nowhere. One of the three text-alias `ORDER BY` bugs lives in it and therefore cannot affect anyone; the other two are live.
- **Two undocumented asymmetries on the overview**: the volume chart ignores the level and environment filters that narrow every other widget, and the per-project top error ignores the level filter that org-wide top errors respects.

Scope for the rollup falls out of it: **74% of measured overview cost is servable, 21% is not** (anything keyed by message), plus everything returning rows.

**Run-to-run variance is ~10%.** The same benchmark on the same machine against the same corpus gave a 106.4 ms fan-out and then 94.5 ms, with each run reporting ±3–4% internally. So the noise floor is wider than the tool's own error estimate, and **a local change claiming less than roughly 10% is indistinguishable from nothing**. Anything smaller has to be argued from `pg_stat_statements` proportions or measured on a quieter host.

Two more things worth carrying forward. **The fan-out costs about what its slowest member costs** (106 vs 100 ms), so at one viewer the queries really do run in parallel and the 10-connection pool is not yet the constraint. And **the ranking disagrees with the audit**: bucketing is four times top-errors here, where the droplet's single most expensive query was top-errors at 654 ms — despite this corpus having 2.4× the distinct messages, which should have gone the other way. So the droplet's 654 ms is not explained by query shape. Hardware, the stock Postgres configuration, and concurrent ingest are the remaining candidates, and separating them is the rest of Stage C. **One local run is not grounds to reorder Stage E** — that is how the current ordering was arrived at, and why the discussion gate exists. The repository's db-mocking pattern stubs the Drizzle query builder and cannot reach `db.execute(sql\`…\`)`; asserting on generated SQL text would test the string rather than the answer. Correctness there needs a real Postgres, which makes the seeding/connection harness shared with Stage C's benchmark — **so the B/C boundary is itself on the table at the next discussion.** Two datasets are needed either way: a small deterministic corpus for correctness, and a large one for measurement, since nothing reproduces a 1.4 s page at a thousand rows.

⚠️ Note for whoever builds that harness: `e2e/support/cleanup.ts` does `DELETE FROM events` against `logger_test`, so a corpus seeded once by hand into that database is destroyed by the next `npm run test:e2e` run.

> ⚠️ **Each stage of §16.1 opens with a discussion, not with code.** A finished stage is not authorisation to start the next one — see the decision-log entry for 2026-08-20. Do not pick up Stage C because Stage B closed.

**The storage engine decision is deferred until 1M+ events** and is deliberately *not* part of this workstream. Postgres stays. Reasoning, including why deferring is unusually cheap here and what does get more expensive with delay, is in `PLAN.md` §17.

**Production readiness: features ~85–90%, operations ~80%.** Packaging, delivery, CI and — since the staging run — TLS, ingest under load and alert delivery are closed. What is left is email, offsite-backup verification, the update path, and this workstream.

### Blockers before production

| # | Blocker | Where |
|---|---|---|
| 1 | ~~No deployment artifacts~~ | **Closed 2026-08-13** — Feature 08, 30/30 |
| 2 | ~~No standalone worker process~~ | **Closed 2026-08-13** — `core/worker/main.ts` → `dist/worker.js`, its own container |
| 3 | **Password reset does not send email.** `sendResetPassword` writes the reset URL to the log and returns. A user who forgets their password cannot recover without an operator reading `docker compose logs app`. (Invitations are copy-link by design — that decision stands; reset is a different case.) **This is now the only hard blocker.** | `core/auth/config.ts` |
| 4 | ~~No backups~~ | **Closed 2026-08-13** — `backup` service, rotation, `scripts/restore.sh`, both live-checked. ⚠️ **Offsite (`OFFSITE=true`) is still unverified** — no bucket was configured, so only the failure paths were exercised |
| 5 | ~~No CI~~ | **Closed 2026-08-13** — `.github/workflows/ci.yml` (four gates + image build) and `release.yml` (tag → ghcr.io) |

### Known gaps, not blockers

- **Staging run: partly done, 2026-08-19.** A throwaway DigitalOcean droplet at `stage.proeball.com`, deployed from the first-ever release tag (`v0.1.0-rc1` → `ghcr.io/proeball/logger`). **Closed by it:** real ACME issuance (worked first time, Let's Encrypt certificate on the real domain), HTTP→HTTPS redirect, `/api/health/ready`, the whole documented ingest contract including the attribute type registry and rate limiting, alert evaluation with both firing and resolve webhooks, the SSRF guard on live delivery, and 2 hours of sustained load (41,762 events, zero failures, flat latency). Sizing measurements are recorded in [`LAUNCH.md`](LAUNCH.md#01-where-it-runs); the DigitalOcean walkthrough in its Appendix B. **Still unproven:** offsite backup with `OFFSITE=true` against a real bucket, the update path (`docker compose pull && up -d` onto a new tag), and unattended reboot recovery.
- **`projects.retention_days` is not enforced.** The column is read and exposed through the projects service, but partition retention is globally hardcoded to `'30 days'` in migration 0003 — confirmed again during the Feature 08 live check (`part_config.retention = '30 days'` on a freshly migrated database). PLAN.md §14 records this as a deliberate deferral; the open question is whether to implement it or stop exposing the value.
- **Ingest rate limiter is single-instance in-memory** — needs a shared store before running more than one `app` replica.
- **No rate limiting on `/api/auth/*`** — login and password-reset requests are not throttled. The actions are test-covered for enumeration-safety, but throttling is a separate, still-missing control.
- **Secrets live in one `.env` on the host**, protected only by `chmod 600`. No secret manager, no rotation procedure. Backups are unencrypted at rest.
- **Neither `test:it` nor `test:e2e` runs in CI.** CI has no Postgres at all — `DATABASE_URL` there is a throwaway value for `core/env`'s import-time validation. The integration suite is the closer of the two to being addable (no app instance, ~1 s, self-seeding); its blocker is that migration 0003 needs `pg_partman`, which the stock `postgres:16` image a `services:` block provides does not have. See [`reference/misc.md`](reference/misc.md#continuous-integration).
- **`aggregations.service.ts` has no tests** — the project dashboard's raw-SQL aggregations. `overview.service.ts` was closed on 2026-08-20 by the integration suite, and the same harness would cover this one; the fixture would need extending with per-project cases. Note it *looked* covered until that day: `aggregations.service.test.ts` never imported the service it was named after — it tested `utils/aggregation-utils.ts` — and renaming it is what made the gap visible. See [`reference/misc.md`](reference/misc.md#testing).
- **`features/dashboard/utils/aggregation-utils.ts` imports from `features/events/`** (`event-filters.types`) — a feature-to-feature import, against `PROJECT.md` §2.1. Pre-existing; found while extracting the overview utils and deliberately not fixed in that change, because moving the `TimeRange` type to `shared/` touches three features and the extraction had to stay behaviour-neutral.
- ~~**The org overview is rendered by e2e but never asserted**~~ — **closed 2026-08-20** by `e2e/overview.spec.ts` (17 tests). Until then `login()` (`e2e/support/auth.ts:42`) rendered `/[org]` on every test in every spec and only ever checked the URL, so a page showing all zeros would have passed the suite.
- **Count columns are ordered as text in `features/dashboard/services/aggregations.service.ts`** — `levelBreakdown` (~109), `environmentBreakdown` (~132), `topSources` (~256) select `COUNT(*)::text AS count` and then `ORDER BY count DESC`, which binds to the text alias and ranks `"9"` above `"10"`. `topSources` has a SQL `LIMIT 10` and `EnvironmentBreakdownWidget` takes `.slice(0, 8)`, so both return the wrong rows, not just the wrong order; `levelBreakdown` is masked by the widget re-sorting. The same bug was fixed in `overview.service.ts` on 2026-08-20 — see [`reference/logging.md`](reference/logging.md#ordering-count-columns-are-cast-to-text). Not fixed here because there is no test that could prove it, which is itself §16.1 Stage B/C work.
- **Read-path performance** — findings are collected in [Read-path audit](#read-path-audit-2026-08-20) below rather than listed here, because they are a sequenced workstream (§16.1) and not independent gaps.
- ~~**`scripts/seed-events.mjs` is broken**~~ — **deleted 2026-08-19.** It wrote to Postgres directly, bypassing everything the ingest API enforces. Replaced by three API-based load scripts documented in [`reference/misc.md`](reference/misc.md#scripts-that-feed-a-running-instance).
- **`scripts/apply-migrations.mjs` is unsafe** — it writes migration *names* into `drizzle.__drizzle_migrations` where drizzle expects content *hashes*, so a database it has touched will not agree with either real migrator. Not used by any supported path; a candidate for deletion.

---

## Read-path audit (2026-08-20)

Findings from the staging run. Each is evidence for a stage in [`PLAN.md` §16.1](PLAN.md#161-post-beta-workstream-read-path-performance) — the plan carries the ordering and the reasoning, this section carries the measurements.

**The measurements themselves.** 540k events across two projects, on 2 vCPU / 4 GB. Org overview: **1.4–1.6 s**, near-identical for 24h, 7d and 30d ranges (the install is two days old, so all three cover the same data). Host during it: **8% CPU**, memory flat at 27%, load-1 spiking to 2.78 while CPU stayed low — waiting, not computing. Isolated `EXPLAIN (ANALYZE, BUFFERS)` of the top-messages aggregation: **654 ms**, of which the partition scan is 166 ms and the rest is sorting and merging 68,933 groups to return ten of them.

### Structural

- **No read caching anywhere.** `next/cache` appears only as `revalidatePath` after mutations. The app is fully dynamically rendered (the CSP nonce forces it — `PLAN.md` §17), so every viewer recomputes every aggregation on every load. **Load scales with the number of people looking at dashboards, independently of ingest volume** — the multiplier that matters most if other teams start using this.
- **The org page defeats its own streaming.** `app/[org]/(org-shell)/page.tsx:41` awaits a `Promise.all` of six calls — one of which, `getProjectSummaries`, is itself a `Promise.all` of three — before rendering anything. That is **seven aggregations over `events` per page load** — measured with `pg_stat_statements` on 2026-08-20, each with an identical call count, so there is no N+1 hiding in the fan-out. (This entry originally said eight, counted by hand; the eighth query is the per-project alert-rule lookup, which does not touch `events`.) 1.4 s is time-to-first-pixel. `Suspense` is imported in `OverviewPage.tsx` and has nothing to do.
- **Connection pool is 10** (`core/db/client.ts:15`). One overview load takes eight slots; two concurrent viewers queue.
- **Every page has a serialised prologue** — `getCurrentUser` → `getOrgBySlug` → `getMembership` → `getProjectBySlug`, four round trips before any real work, not batched. The project dashboard adds a fifth (`hasAnyEvents`) before its own `Promise.all`.

### Queries

- **`getOrgEnvironments` scans 30 days on every load** ([`overview.service.ts:216`](../features/overview/services/overview.service.ts)) — the interval is hardcoded, so it ignores the selected range, and it exists to populate a dropdown with two values. There is no index on `environment`. The `attribute_key_types` registry already in the codebase is the pattern that would make this constant-time.
- **Five facet-count aggregations run on every events-page load**, whether or not the filter panel is open.
- **Top messages groups by `SUBSTRING(message, 1, 200)`** — an expression, so no index can serve it, and the cost tracks the number of *distinct* messages rather than rows.
- **No indexes on `environment`, `source`, `release`**, all of which are filterable and facetable. Adding them is not free on a table taking a thousand inserts a minute.

### Configuration

- **Postgres is entirely untuned.** `db/Dockerfile` is stock `postgres:16` plus `pg_partman`; neither it, `db/init/`, nor `docker-compose.yml` sets a single parameter. Running defaults: `shared_buffers` **128 MB** on a 4 GB host, `work_mem` **4 MB**. At 540k events the working set was ~130 MB — disk reads had just started appearing (`hit=15261 read=1336`) and the hash aggregate was using 5153 kB of its 8 MB budget (`work_mem` × `hash_mem_multiplier`), i.e. **64% of the way to spilling**.
- **`pg_stat_statements` is not installed.** The app's own slow-query logger only fires at ≥500 ms, so a 80 ms query called two hundred times a minute is invisible — which is the shape this workload actually has.

### Method caveat, recorded so the numbers are read correctly

An earlier measurement of the same query returned **111 ms**, and it was worthless: the load generator used twelve fixed message strings, so the aggregate saw 275 groups. The generator now spans three cardinality classes (~48% distinct) and the honest figure is 654 ms. Any future comparison — including between storage engines — must use data with realistic message cardinality, or it will flatter whatever is being tested. See [`reference/misc.md`](reference/misc.md#scripts-that-feed-a-running-instance).

---

## Post-Feature-07 work (not tracked as numbered features)

Recorded here so the roadmap table isn't the only history.

**2026-08-13 — Feature 08: Docker packaging.** See the feature doc for the full checklist. Beyond the artifacts, three latent defects were found by running the stack rather than reading it, each fixed with a regression test that fails against the old code:

1. **pg-boss 12 requires `createQueue` before `schedule`/`work`.** The worker crash-looped on any fresh database with `Queue partman-maintenance not found`. Invisible in dev, where the queue rows already existed from an older pg-boss.
2. **Every failed query raised an `unhandledRejection`.** `slow-query-logger.ts` forked a promise with no rejection handler, so a caller's `try/catch` could not suppress it. Next traps the event; the plain-`node` worker would have terminated on it.
3. **`/api/health/ready`'s migration check had never run.** It queried `"__drizzle_migrations"` unqualified, resolving to `public` instead of the `drizzle` schema, and reported the resulting error as `"unavailable"` — so an app on a half-migrated database still passed its healthcheck.

Also corrected: `/api/version` reported `""` rather than `"dev"` for an unset build SHA (`??` where `||` was needed, exposed by the new empty-string build arg), and `docs/reference/*.md` — which the help centre reads off disk at runtime — would not have shipped in the standalone output without an explicit `outputFileTracingIncludes`. Tests 293 → **332**; gates all green.

**2026-08-13 — Production-readiness hardening.** Security headers (`X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, `X-DNS-Prefetch-Control`, prod-only HSTS) in `next.config.ts`; **nonce-based CSP** minted per request in `proxy.ts` (`style-src` deliberately keeps `'unsafe-inline'` — Recharts emits inline style attributes and a nonce in `style-src` would void it; the whole app is consequently dynamically rendered); **webhook SSRF guard** in two layers (`webhook-url.ts` syntactic + isomorphic, `webhook-target-guard.service.ts` DNS-resolving + server-only) plus `redirect: "manual"`; env schema widened 4 → 8 validated vars with `AUTH_SECRET` raised to `min(32)`; **fixed: alert webhooks built `events_url` from a nonexistent `NEXT_PUBLIC_APP_URL`**, so every webhook ever sent carried a `localhost:3000` link; `shared/hooks/use-is-hydrated.ts` replaces the `useState`+`useEffect` mount-gate idiom in 3 components, dialog resets moved to render-time state adjustment in 4 more. Gates went from 13 TS errors / 1032 lint errors to **0 / 0**; tests 192 → **225**; e2e **53 passing**; build clean. See PLAN.md §17 for the decisions.

**2026-08-13 — In-app help center, e2e isolation, dev-origin fix** (`cf57619`). `features/help` + `app/[org]/(org-shell)/help` with search palette and markdown articles. E2E suite moved to an isolated server + database (port 3100, `logger_test`, `E2E_MODE`) instead of the shared dev instance; ad-hoc live-check scripts replaced by `e2e/support/` helpers. Fixed missing `allowedDevOrigins` in `next.config.ts` — without it Next blocked HMR for any host other than the first one seen, breaking hydration, which made the login form fall back to a native GET submit **leaking the password into the URL and server logs**. Fixed change-password revoking its own session cookie. Theme-preference save is now awaited rather than fire-and-forget.

**2026-08-12 — Attribute-type enforcement, auth UI redesign, roles/events overhaul** (`67ff454`). Ingest validates attribute values against a per-project registered type (`attribute_key_types` + `attribute-type-registry.service`), rejecting conflicting types on later writes. Auth screens rebuilt on a shared `AuthSplitLayout`/`BrandPanel` with a new `PasswordField`. Roles visual pass (`PermissionMatrix`, `RoleEditor`, `RolesList`) plus an assignable-permissions util scoping what a role may grant. Events filter bar refactored from per-field dropdowns into a single `FiltersPopover`, with facet counts moved from client-side computation into the query service.

**2026-08-12 — Dashboard chart fixes** (`0987983`). Events-over-time buckets are zero-filled (a gap in logs rendered as a missing period instead of a drop to zero) and bucket width is tied to the range filter (1h→1m, 24h→1h, 7d→12h, 30d→1d). Decluttered x-axis ticks, date labels for 7d/30d, widget redesign, KPI values matched to sparkline colors.

**2026-08-12 — Per-key rate limits, API key delete, simplified nav** (`8695a9b`). Configurable rate limit per API key (new migration; ingest routes enforce per-key instead of one global limit), delete for revoked keys. Dropped `OrgRail`/`OrgSwitcher` for a single-org sidebar; account/sessions/sign-out moved into `UserMenu`. Sessions list redesign, setup-wizard confirm-password field, two-step empty project state.

**Last completed: Feature 07 — Polish (2026-05-09)**
Toast system (central `ToastProvider` + `useToast` hook, Redux-free reducer, ARIA live region `role="region" aria-live="polite"`, per-toast `role="alert"/"status"`); migrated all inline `alert()` / `saved` state to `toast.push()`; 5 skeleton components (`TableSkeleton`, `WidgetSkeleton`, `CardSkeleton`, `ListSkeleton`, `PageSkeleton`) with design-system tokens; `dynamic()` lazy-loading for recharts widgets (EventsPerMinute, LevelBreakdown, EnvironmentBreakdown) and EventDrawer; error boundary components (`GlobalErrorPage`, `NotFoundPage`, `ForbiddenPage`); 12 `error.tsx` / `not-found.tsx` / `loading.tsx` boundary files across all route segments; session revocation on password change (originally the `revokeOtherSessions: true` body flag — **superseded 2026-08-13** by a separate `auth.api.revokeOtherSessions` call, because the flag also killed the caller's own session and the cookie rotation was unreliable inside a Server Action); E2E test for session revocation (`e2e/auth.spec.ts`); `/api/version` and extended `/api/health/ready` (db, pgboss, ingest, migrations checks); `core/logger.ts` (pino singleton); `slow-query-logger.ts` wraps postgres.js client, WARN at ≥500 ms; `partman-maintenance.job.ts` wrapped in try/catch with ERROR logging; ForbiddenPage wiring — `revokeInvitationAction` returns `{ error? }`, `InvitationsList` converted to client component, `alerts/new/page.tsx` renders `ForbiddenPage` instead of redirect; `EmptyMembers` component for team page; README monitoring endpoints + self-monitoring alert guide; Decision log (10 entries). Manual items deferred: keyboard nav (27), contrast audit (28), EXPLAIN ANALYZE (32). TypeScript clean.

**Last completed: Feature 06 — Alerts (2026-05-09)**
Schema (`alert_rules` + `alert_notifications`, migration 0004), Zod schemas (`shared/utils/event-filters.schema.ts` + `features/alerts/utils/alert-schemas.ts`), `alert-rules.service.ts` (CRUD + `listEnabled` + `listAlertHistory`), `alert-evaluator.service.ts` (evaluateOne with optimistic concurrency on `version`, evaluateAllEnabled with cap-10 concurrency), `build-payload.ts` (webhook JSON with sample events + events_url), `alert-dispatcher.service.ts` (HTTP POST, 2xx/4xx/5xx classification), `alert-evaluation.job.ts` (pg-boss cron `* * * * *`, singletonKey), `alert-delivery.job.ts` (retry options on `send()`), 5 server actions, `alerts.*` i18n namespace, 14 components (`AlertStateBadge`, `AlertRow`, `AlertsList`, `AlertRuleEditor`, `AlertRuleEditorTabs`, `FilterBuilder`, `ConditionEditor`, `WebhookChannelForm`, `ChannelsEditor`, `NotificationOptions`, `SaveBar`, `AlertHistoryTable`, `AlertNotificationRow`, `DeliveryStatusBadge`), 3 routes (`/alerts`, `/alerts/new`, `/alerts/[id]`), 25 unit tests (evaluator state machine, dispatcher HTTP classification, payload builder), 5 DB-level E2E tests (insert, cascade delete, version increment, optimistic concurrency, disabled filter). `serializeFilters` moved to `shared/utils/`. Build clean, TypeScript clean, 147 unit tests.

**Last completed side-track (2026-05-08): Component folder restructure**
All `features/*/components/` reorganized so every component lives in its own named subfolder — matching the `shared/components/` pattern. 118 files moved via `git mv`. Semantic group subfolders (`filters/`, `detail/`, `widgets/`, etc.) kept; flat `parts/` at feature-components root dissolved (shared-within-feature components promoted to own folders; single-parent sub-components nested inside parent's `parts/`). All imports updated, TypeScript clean. Rules updated: `PROJECT.md §2.2`, `§3.3`, `§15`. Two pre-existing TS errors also fixed: `e2e/ingest.spec.ts` (`body` → `data` for Playwright), `getOrgBySlug` explicit return type (`Promise<Org | null>`).

**Feature 05 — Dashboard** · `docs/features/05-dashboard.md`
Status: ✅ Done · 24 / 24 items

**Done:** `aggregation-utils.ts` (`pickBucket` + `resolveRange`, pure helpers extracted for testability), `aggregations.service.ts` (5 raw-SQL queries: `eventsPerMinute` w/ `date_trunc` + stacked by level, `levelBreakdown`, `environmentBreakdown` (null→`(unset)`), `topMessages` (200-char truncation), `recentErrors`, `hasAnyEvents`), extended `TimeRangePreset` to include `"30d"` + updated `parse-filters.ts` + `events-query.service.ts` + `TimeRangePicker` (`presets` prop), `dashboard.*` i18n namespace, `use-dashboard-range.ts` hook (URL state, independent from events page per Q-E3), `WidgetCard` + `WidgetEmpty` + SCSS, `EmptyProjectState` (curl example with API key prefix), 5 widget components: `EventsPerMinuteWidget` (stacked AreaChart), `LevelBreakdownWidget` (donut PieChart, click → events), `EnvironmentBreakdownWidget` (horizontal BarChart, click → events), `TopMessagesWidget` (table, click → events), `RecentErrorsWidget` (list, click → events drawer), `DashboardHeader` (project name + TimeRangePicker w/ 30d + AutoRefreshControl), `DashboardPage` (client composition, `useAutoRefresh` wired), `app/[org]/[project]/page.tsx` replaced placeholder with full SSR: guards empty projects, runs 5 queries in `Promise.all`, passes data to `DashboardPage`, 122 total unit tests (14 new), `e2e/dashboard.spec.ts` (8 tests — DB-level assertions + graceful browser skip), build clean, TypeScript clean.

**Previously done (Feature 04):** `UserPreferences` type + `autoRefresh` field, `user.ts` Redux slice with selectors, `OrgHydrator` updated, `update-preferences.action.ts` widened for autoRefresh, `events.*` i18n namespace, `EventFilters` type + `parse-filters.ts` + `serialize-filters.ts` + `parse-cursor.ts` (20 unit tests), `events-query.service.ts` (listEvents w/ dynamic Drizzle query, cursor pagination, defense-in-depth project soft-delete guard, FTS via websearch_to_tsquery, jsonb attribute filter; getEventById), `app/[org]/[project]/events/page.tsx` (SSR, searchParams → filters → query), `EventsPage.tsx` (client composition), `useEventFilters` hook (URL sync, cursor reset on filter change), `EventsFilterBar` + all filter components (LevelFilter, StringListFilter, CorrelationFilter, AttributeFilter, MessageFilter, TimeRangePicker, AddFilterDropdown, FilterChips), `EventsTable` + `EventTimestamp` (Intl + Tooltip), `PaginationControls` (cursor-based Newer/Older), `EventDrawer` + `EventDetailHeader` + `EventDetailTabs` + `AttributesList` (hover "Filter by") + `ContextTree` (JsonTree) + `StackTraceViewer` + `StackFrame`, `stack-trace-parser.ts` (V8/Python/Java, 6 unit tests), `AutoRefreshControl` + `useAutoRefresh` (visibility-aware, pause on hidden tab), `e2e/events.spec.ts` (7/8 passing — browser test skipped gracefully without active auth session), 108 total unit tests, build clean. DB singleton fix: `core/db/client.ts` now uses global singleton + pool limit (max:10) to prevent connection exhaustion under Next.js hot reload.

**Previously done (Feature 03):** Custom Postgres Docker image with pg_partman 5.4.3, `events` partitioned table (daily, 30d retention, 8 partitions premade), migration 0003 hand-edited for partman setup, Drizzle schema + 5 indexes (composite + GIN), `event-schema.ts` (Zod, single + batch), `sanitize-timestamp.ts`, `enrich-event.ts`, `rate-limit.service.ts` (RollingWindowLimiter, lazy cleanup, configurable via `RATE_LIMIT_PER_MIN`), `api-key-auth.service.ts` (Bearer token, debounced last_used_at), `ingest.service.ts`, route handlers (`POST /api/ingest`, `POST /api/ingest/batch`, OPTIONS CORS), `partman-maintenance.job.ts` (pg-boss hourly schedule, singletonKey), `core/worker/worker.ts`, `instrumentation.ts` (`WORKER_IN_PROCESS=true`), README.md with curl examples + field reference, E2E spec `ingest.spec.ts`, 28 new unit tests (82 total), build clean.

**Previously done (Feature 02):** Drizzle schema (projects, api_keys), slugify utils + key-generator + key-hash (18 unit tests), projects.service + api-keys.service, Redux project slice, 5 server actions, all components, all app routes, E2E specs (projects.spec.ts, api-keys.spec.ts), full live check passed.

**Previously done (Feature 01):** full auth, orgs, invitations, member management, roles CRUD, account pages, org settings, full App Shell, unit tests (36/36), E2E spec files, full 10-step live check passed.

---

## Roadmap

Each feature has its own implementation doc with a status block, decisions, schema, server actions, components, routes, and a step-by-step checklist.

| # | Feature | Status | Doc |
|---|---|---|---|
| — | Design System + UI kit v0.1 (side track) | ✅ Done | [features/design-system.md](features/design-system.md) |
| — | Design System v0.3.0 Update (side track) | ✅ Done | [features/ds-v03-update.md](features/ds-v03-update.md) |
| 00 | Foundation | ✅ Done | [features/00-foundation.md](features/00-foundation.md) |
| 01 | Auth + Organizations + Roles | ✅ Done | [features/01-auth-organizations-roles.md](features/01-auth-organizations-roles.md) |
| 02 | Projects + API keys | ✅ Done | [features/02-projects-api-keys.md](features/02-projects-api-keys.md) |
| 03 | Ingest | ✅ Done | [features/03-ingest.md](features/03-ingest.md) |
| 04 | Events list + filters + detail | ✅ Done | [features/04-events-list-filters.md](features/04-events-list-filters.md) |
| 05 | Dashboard | ✅ Done | [features/05-dashboard.md](features/05-dashboard.md) |
| 06 | Alerts | ✅ Done | [features/06-alerts.md](features/06-alerts.md) |
| 07 | Polish | ✅ Done | [features/07-polish.md](features/07-polish.md) |
| 08 | Docker packaging | ✅ Done | [features/08-docker-packaging.md](features/08-docker-packaging.md) |

Status legend:
- ⬜ Not started — no work yet
- 🟦 Planned — feature doc detailed, ready to implement
- 🟨 In progress — work started, see checklist
- ✅ Done — all checklist items complete, live check passed

"Planning pending" means the feature doc is a stub. We detail it when we reach it (or earlier if dependencies require).

---

## How to Resume After a Break

1. Read this file (PROGRESS.md) → identify current phase.
2. Open the linked feature doc.
3. Read its **Status**, **Locked decisions**, and **Implementation Checklist** sections.
4. Find the first unchecked item.
5. Continue.

If the feature doc says "planning pending" — stop and ask the user to detail the feature before implementation.

For "what does the code actually do right now", prefer `docs/reference/` over the planning docs — it is regenerated from the codebase and calls out where PLAN.md and the feature docs have drifted.

---

## Conventions

- **Doc updates**: when a feature is touched, update its status block (`Last touched`, `Progress: X/Y`). Update PROGRESS.md row.
- **Decisions made mid-implementation**: log them in the feature doc's "Decision log (local)" section. If the decision affects more than one feature → also append to PLAN.md §17.
- **New permission added**: register in `shared/permissions/registry.ts` AND list in PLAN.md §5 AND mention in the feature doc that introduced it.
- **New env variable**: add to the Zod schema in `core/env/index.ts` AND `.env.example` AND `docs/reference/stack.md` AND the feature doc. Reading `process.env` directly is reserved for build-time metadata and test-only flags — anything read at runtime goes through the schema so a malformed value fails at boot rather than at the call site. (A var referenced in code but present in none of these is exactly how `NEXT_PUBLIC_APP_URL` silently broke every alert webhook for months.)
- **Anything that fetches a user-supplied URL server-side**: route it through the SSRF guard (`features/alerts/services/webhook-target-guard.service.ts`) — don't hand-roll a second check.
