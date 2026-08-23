# Progress

> Single source of truth for "where are we right now". Update after every work session.

**Last updated**: 2026-08-23 (§16.3 steps 0–4: message normaliser, fingerprint, template rollup, two-path topMessages — built, not deployed)

---

## Current Phase

**§16.3 steps 0–4 shipped 2026-08-23 — the template rollup is built, and nothing
is deployed.** `normalizeMessage` and a stable FNV-1a fingerprint; migrations
0009–0010 (`events.template_hash`, `message_templates`,
`event_template_rollup`, a coverage interval on `rollup_state`); ingest computes
and stores the hash and registers the template; the rollup job builds the table
in the same window and transaction as the level rollup; and `topMessages` reads
it wherever coverage allows, falling back to raw text where it does not.

The number that justified all of it: **674,634 distinct messages in a day
collapse to 18,080 templates, a factor of 37.3** — measured on staging *before*
anything was built, against a threshold set before the measurement (build at
20×, stop below 3×).

Two things this cost that were not in the plan. The coverage model needed a
second migration, because a single watermark cannot describe a rollup that has a
floor as well as a ceiling — found while writing the job, not while designing
the schema. And the first version of the read-path tests measured nothing: the
fixture's message and its template were the same string, so both
implementations returned identical rows and disabling the rollup branch entirely
still passed.

**Step 6 shipped the same day** — `dist/backfill-template-hash.js`, run once per install (see [OPERATIONS.md](OPERATIONS.md)). Verified locally against 21,474 events: every row fingerprinted, 1,112 templates registered against 1,112 distinct hashes, no orphans. Until it runs, the rollup only
covers events ingested after the deploy, so 7-day and 30-day reads keep taking
the slow path — the win arrives gradually rather than at the release.

**v0.4.0 shipped 2026-08-22** — loading states on both dashboards and the range
chips answering the click. Verified on staging: the chip goes active at 829 ms
with `aria-busy`, and the per-widget skeletons make the expensive query visible
from the page itself.

**And the read path hit a ceiling the same day — [`PLAN.md` §16.3](PLAN.md#163-the-read-path-ceiling-and-what-a-message-ought-to-be).**
The staging corpus reached **8,895,570 events**, +3.4M in twenty-four hours, and
the project dashboard's cold 7d went **17.5 s → 40.1 s**. Warm loads stayed at
300–500 ms, so the cache still does exactly what it was documented to do and
nothing more. At this rate the corpus levels off near **100M** under 30-day
retention.

Three hypotheses were tested and refuted in one session, with session-scoped
`SET` and no server change: `work_mem` bought **7%** and 512 MB made it *worse*;
JIT costs 2,098 ms of the ~29 s; and hashing turned out not to be rejected but
**forbidden** — `mode() WITHIN GROUP (ORDER BY level)` is an ordered-set
aggregate, and one in the select list rules out `HashAggregate` at any
`work_mem`. Removing it: **26,855 ms → 17,021 ms, −37%**.

That fix is queued rather than shipped — a query change the night before a demo
is exactly what this workstream keeps telling itself not to do. The demo runs on
a warmed cache.

The structural answer is recorded as a rule in §17: **`message` is the name of an
event; variable data belongs in `attributes`.** `Session sess_pw62y expired` is a
unique string and also the same event forty thousand times; the identifier
belongs in `attributes.session_id`, where this product already types and filters
it. What blocks sizing a template rollup is that our own load generator was built
deliberately high-cardinality to stress the hash aggregate, so the 7.4% distinct
it reports is a worst case rather than an expectation. A realistic generator
profile comes first.

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

**Both increments are done.** `getOrgEventBuckets`, `getOrgLevelBreakdown` and `getProjectStats` all read the rollup; only the message-keyed queries still touch `events`. *(`getProjectSummaries` as written that day; it was split into `getProjectStats` and `getProjectTopMessages` later the same day — see the Stage E entry below.)*

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

`getProjectStats` keeps two paths: without an environment filter it reads `total` and `errors` straight off the summary row, but an **environment** filter needs errors-per-environment — a joint the marginals do not hold — so that read still goes to `events`. Both paths are pinned against direct counts.

*(As written that day there was a third path: `by_level` unrolled per minute to serve a level filter. The filter was removed later the same day and the branch with it — see the filter-bar entry below.)*

**The comma-in-environment bug is fixed as a side effect.** The pills come from JSON keys now, so there is no `STRING_AGG`/`split(",")` pair left to break them. The test that pinned the bug was inverted, not deleted — it failed the moment the fix landed, which is exactly what it was for. New divergence in its place, deliberate and tested: above the 20-environment cap the pill list is the top 20 plus `(other)`, not the raw `DISTINCT`.

**The raw tail costs about 0.3–0.6 µs per event in it**, and its width depends on how far behind the rollup is, not on the range being charted: 0.12 ms for a two-minute tail, 7.7 ms for a four-hour one. Steady state is at most a minute of ingest. A stalled job therefore degrades speed and not correctness — the worst case is the ~91 ms the query took before the rollup.

⚠️ The first attempt at this measurement was **meaningless and nearly reported as a win**: the benchmark builds the rollup immediately before measuring, so the boundary landed past the newest event and the tail was empty. "The tail is free" was measuring nothing at all. The bench now pushes the boundary back deliberately (`BENCH_TAIL_MINUTES`, default 2) to match production. Same class of error as benchmarking the environments registry against an unpopulated table.

Verification is mostly **agreement, not existence**: the integration tests compare rollup-backed reads against direct counts of `events` — total, per level, with and without a filter, and after a fresh insert that no rebuild has seen. 16 new integration tests. *(67 in total as of 2026-08-20, after the level-filter removal deleted three.)*

**Auto-refresh** is now `off | 30s | 60s | 5m`. `10s` went for its **cost** — six page loads a minute per viewer, for a difference nobody acts on. It was first justified here as "the rollup only changes once a minute, so a faster refresh sees the same numbers"; that is **wrong**, and corrected on the spot: reads union the rollup with a raw tail, so freshness is not gated by the rebuild cadence at all. A stored `10s` is **translated to `30s`** rather than falling back to the default, which would have silently switched auto-refresh off for everyone who had chosen it.

⚠️ The same mistake reached two other claims and has been corrected in both: **"every viewer sees identical numbers" holds only below `rolled_up_to`.** The raw tail is computed per request, so the newest minute can still differ between two viewers by whatever arrived between their loads. The rollup turns "every figure may differ" into "only the newest minute may differ", which is the real, smaller claim.

**Streaming done, 2026-08-20 — Stage D item 3.** `app/[org]/(org-shell)/page.tsx` no longer awaits a `Promise.all` of every aggregation before rendering. It starts each query, passes the **promise** down, and `OverviewPage` is six independent `Suspense` boundaries: filter bar, KPI row, volume chart, projects panel, top errors, level breakdown.

Passing promises rather than letting each section fetch is the substance of it. Two sections need the bucket query and two need the summaries; a section-fetches-its-own design would have issued both **twice**, so a change made to speed the page up would have slowed it down. Verified with `pg_stat_statements` against `logger_test`: all six aggregations record identical call counts, including the bucket query that two sections await. It also keeps the cross-feature calls in the route, where §2.3 permits data loading, rather than importing `features/projects` and `features/alerts` into `features/overview` against §2.1.

The 17 overview e2e tests written earlier the same day passed unchanged — which is the return on having written them before the optimisation rather than after.

⚠️ **The benefit is not observable locally.** Every query returns in milliseconds against a developer machine, so there is nothing to stream. This pays off on the constrained host where the page measured 1.4 s, and it is not yet confirmed there.

**Widget inventory written before designing the rollup** — [`reference/widgets.md`](reference/widgets.md), registered as a help-centre category so it is readable in the app. Every read surface across the overview, the project dashboard and the events page: which query backs it, what it groups by, which filters it responds to, its measured share, and whether a rollup could serve it.

Three things it turned up that reading two widgets would not have:

- **`release` is the dimension that must never enter a rollup.** Environment cardinality was the risk everyone saw; a release identifier is *designed* to change on every deploy, so it is strictly worse and far less obvious. The releases facet stays on raw events.
- **`EnvironmentBreakdownWidget` and `environmentBreakdown()` are dead code** — rendered nowhere, called nowhere. *(Superseded 2026-08-21: both deleted, along with `EnvCount` and the i18n key. The claim that the widget also had an orphaned SCSS module was wrong — it was the only widget in that folder without one.)* One of the three text-alias `ORDER BY` bugs lives in it and therefore cannot affect anyone; the other two are live.
- **Two undocumented asymmetries on the overview**: the volume chart ignores the level and environment filters that narrow every other widget, and the per-project top error ignores the level filter that org-wide top errors respects. *(The second was closed later the same day by removing the level filter; the first now reads as "ignores the environment filter".)*

Scope for the rollup falls out of it: **74% of measured overview cost is servable, 21% is not** (anything keyed by message), plus everything returning rows.

**Run-to-run variance is ~10%.** The same benchmark on the same machine against the same corpus gave a 106.4 ms fan-out and then 94.5 ms, with each run reporting ±3–4% internally. So the noise floor is wider than the tool's own error estimate, and **a local change claiming less than roughly 10% is indistinguishable from nothing**. Anything smaller has to be argued from `pg_stat_statements` proportions or measured on a quieter host.

Two more things worth carrying forward. **The fan-out costs about what its slowest member costs** (106 vs 100 ms), so at one viewer the queries really do run in parallel and the 10-connection pool is not yet the constraint. And **the ranking disagrees with the audit**: bucketing is four times top-errors here, where the droplet's single most expensive query was top-errors at 654 ms — despite this corpus having 2.4× the distinct messages, which should have gone the other way. So the droplet's 654 ms is not explained by query shape. Hardware, the stock Postgres configuration, and concurrent ingest are the remaining candidates, and separating them is the rest of Stage C. **One local run is not grounds to reorder Stage E** — that is how the current ordering was arrived at, and why the discussion gate exists. The repository's db-mocking pattern stubs the Drizzle query builder and cannot reach `db.execute(sql\`…\`)`; asserting on generated SQL text would test the string rather than the answer. Correctness there needs a real Postgres, which makes the seeding/connection harness shared with Stage C's benchmark — **so the B/C boundary is itself on the table at the next discussion.** Two datasets are needed either way: a small deterministic corpus for correctness, and a large one for measurement, since nothing reproduces a 1.4 s page at a thousand rows.

⚠️ Note for whoever builds that harness: `e2e/support/cleanup.ts` does `DELETE FROM events` against `logger_test`, so a corpus seeded once by hand into that database is destroyed by the next `npm run test:e2e` run.

**Verified on the droplet, 2026-08-20 — `v0.2.0`.** The rollup and streaming were measured on the constrained host, which is where the claims above said they had to be. Page wall-clock, ingest still running so the "after" column carries **2.4× more data** than the 540k the original figure came from:

| range | before | after |
|---|---|---|
| 7d | 4.31 / 4.42 / 4.64 / 6.25 s | 1.03 / 1.08 / 1.15 / 1.28 / 1.34 s |
| 30d | 4.78 s | 0.955 / 1.01 / 1.12 / 1.14 / 1.25 s |
| 1h | — | 0.199 / 0.224 s |
| 15m | — | 0.160 / 0.285 s |

≈ **4.2× at 7 days, ≈ 4.4× at 30 days** — means of the samples above, which is the only figure that reconstructs from them; an earlier revision of this line said 3.6× and 4.7× and matched no method at all. The rollup caught up to **2,481 rows from 1,302,062 events — a 525× reduction**. Three defects in the `OPERATIONS.md` runbook were found and fixed during the deploy: the image tag carries no `v` prefix, `psql -U "$POSTGRES_USER"` must be wrapped in `sh -c`, and `git pull` fails on a host checked out at a tag.

**`pg_stat_statements` over 5 page loads then said where the remaining second went**, and it was not where the plan assumed:

| per load | query |
|---|---|
| **1006 ms** | `getOrgTopErrors` — org-wide top errors |
| **954 ms** | per-project top message inside `getProjectSummaries` |
| 35.5 ms | level breakdown *(rollup)* |
| 23.3 ms | environment pills *(rollup)* |
| 19.9 ms | volume buckets *(rollup)* |
| 8.0 ms | per-project stats *(rollup)* |

**The two message-keyed queries are ~96% of the page's database time.** Everything the rollup serves totals ~87 ms. Every read query recorded exactly **5 calls for 5 loads** — the promise-sharing design holds on a real production build, not just locally.

Two corrections to expectations came out of this. Top errors is **already capped at 24h and is still the single most expensive query** — because the corpus spans ~3 days, so a 24h cap halves the range rather than shrinking it thirtyfold; the cap will earn its keep at 30 days of data, not now. And because the queries run in parallel, the page is bounded by the **slowest**, not the sum: capping the per-project top message would have cut database work without making the page faster at all. That killed the planned next change before it was written.

**Caching landed, 2026-08-20 — Stage D item 5, for the org overview.** The trigger was a requirement, not a measurement: the target became **50–100 concurrent dashboards**. At ~2 s of database CPU per load that is ~6.8 cores to compute one answer two hundred times, and reducing the two message-keyed queries to zero would still leave ~0.29 cores spent on 200 identical computations a minute (~2.9 cores at 1,000 readers). At that point the problem stops being query speed.

`shared/utils/ttl-cache.ts` (single-flight, stale-while-revalidate, hard staleness ceiling, injectable clock) with `features/overview/services/overview-cache.service.ts` in front of every overview query: 30-second TTL, 5-minute ceiling.

Verified with `pg_stat_statements` against the running dev server, which is what makes it more than a unit test: a second load inside the window issues **none of the five aggregations** (the page keeps four cheap uncached calls — org, membership, project list, alert rules); a different preset misses; and both the environment filter list and top errors **hit** across a 7d→30d change — the first because it is keyed without a range, the second because `clampTopErrorsWindow` maps both presets to 24h, so the page's most expensive query is served from cache even when the range changes.

The cache key is treated as an **authorization boundary** — it carries the full project scope, and both test files assert the separation. Today no two members of an organization have different scopes, so this is defence in depth; it is in the key because a key without it would not fail loudly the day per-project visibility arrives. See [`reference/security.md`](reference/security.md#cached-reads-and-the-scope-in-the-cache-key).

⚠️ **What this does not do.** A cache bounds how *often* an expensive query runs, never what it costs. At 30 days of data the message-keyed aggregations will still be paid once per TTL, and the first reader past the 5-minute ceiling waits for one. The project dashboard is still uncached, and `aggregations.service.ts` still has no test beside it (`utils/aggregation-utils.ts` does).

⚠️ **The 30-day question is still open.** Every measurement so far — local and droplet — is on a corpus spanning ~3 days against a 30-day retention. `range=30d` currently reads everything there is, not thirty days. The rollup-backed half is indifferent to that; the message-keyed half scales with it. `scripts/seed-bench.mjs` takes `BENCH_DAYS`, but `pg_partman` premakes only ±7 days, so anything older lands in `events_default` and measures the wrong thing — past partitions must be created first.

**Overview filter bar reworked, 2026-08-20.** Two changes, both from looking at the page rather than at the code.

**The level chips were removed.** They narrowed three of the page's eight widgets and left five visibly unchanged — the volume chart ignores level filters by construction, the level breakdown is *about* levels, and the per-project top message never received the filter at all. Three moving and five not does not read as a filter with a scope; it reads as a broken one.

Removing it closed two open items for free rather than fixing them:

- the **known inconsistency** between the per-project top message and org-wide top errors ([logging.md](reference/logging.md)) — both readings of it disappeared with the filter that produced them;
- one of the two **documented asymmetries** in [widgets.md](reference/widgets.md). The other, the volume chart ignoring the environment filter, remains.

`getOrgTopErrors` also lost its caller-supplied `levels` override — `error, fatal` is now fixed. The parameter existed only for this filter, and a widget labelled "top errors" that a caller can ask for debug lines is a defect waiting for a second caller.

Deleted with it: two integration tests and two e2e tests. The e2e test that pinned the defect ("KNOWN BUG: a level filter does not reach the per-project top message") was replaced rather than dropped — what stands in its place asserts the property removal has to hold, that a bookmarked `?levels=info` URL now narrows nothing.

**Auto-refresh was added — the overview was the only dashboard without it.** The control already existed, in `features/events/components/auto-refresh/`, and `features/dashboard` was importing it from there — a **§2.1 violation**. Adding a third consumer made the shared home unavoidable, so `AutoRefreshControl` moved to `shared/components/`, `use-auto-refresh` to `shared/hooks/`, and the strings from the `events` i18n namespace to `common`.

⚠️ **Auditing that claim found something bigger.** An earlier draft of this entry called the violation "a single arrow that had gone unnoticed". It is not: the tree holds **54 cross-feature imports in non-test source across 19 feature pairs**, and `dashboard → events` alone is 14 of them. §2.1 is the most-violated rule in `PROJECT.md`, it has no lint backing it, and most of the 54 are actions reaching for `getMembership`/`getProjectBySlug` — an authorization helper that probably belongs in `shared/`. Recorded in `PROJECT.md` §2.2 as a baseline rather than fixed here; the real fix is an import-boundary rule, which is its own task.

That move surfaced a live display bug: `getLabel` stripped `"s"` from the value and appended it back from a seconds-only template, so **`5m` rendered as "5ms"** from the day that option was added earlier the same session. Nothing failed, because a label assembled inline in a component is a branch no test can reach. The parsing is now `splitAutoRefresh()` in `shared/types/user-preferences.types.ts`, beside `parseAutoRefresh`, with two tests plus a parameterised case over every seconds value.

⚠️ Worth knowing about the pairing: the shortest refresh interval is 30 s and the read-cache TTL is also 30 s, so a refresh can land on a value up to 30 s old — effective staleness on the overview reaches a minute.

**Per-project queries split, 2026-08-20 — §16.1 Stage E.** `getProjectSummaries` became `getProjectStats` and `getProjectTopMessages`.

They were one function returning one map behind one promise. The statistics and environment queries are rollup-backed and cost ~30 ms; the per-project top message is a `SUBSTRING(message, 1, 120)` aggregation over raw `events` and cost **~954 ms** on staging. Behind a single promise, every consumer of the cheap half waited for the expensive one — including the **KPI row**, whose four headline numbers are entirely rollup-backed and which does not render a message at all.

| | before | after |
|---|---|---|
| KPI row | ~954 ms | ~30 ms |
| project table numbers | ~954 ms | ~30 ms |
| top-error column | ~954 ms | ~954 ms |

⚠️ **This made no query faster.** Re-measured with `pg_stat_statements` after the split: still **10 SQL statements** per uncached load across 8 shapes, and `rollupBoundary` still 3 calls. Nothing was removed and nothing was optimised — the cheap things stopped waiting for the expensive one. The instinct on a slow page is to attack the slow query; here the larger win was available without touching it.

It is the same mistake Stage D fixed one level up. That change split the page out of a single `Promise.all` into six `Suspense` boundaries; this one found the same shape *inside* one of those boundaries.

**How the streaming cell works.** `ProjectsSection` is a client component (the Cards/Table toggle is `useState`), so a server `<Suspense>` cannot be written inside it. Rather than pass the promise down and unwrap it with `use()` on the client, `OverviewProjectsPanel` renders the cell on the server — `parts/TopMessageSlot.tsx`, wrapped in `Suspense` — and hands each row the finished `ReactNode`. Next's docs call this the slot pattern and confirm Server Components passed as props render on the server. It keeps the query, the await and the boundary together where the promise already lives.

Two slot maps, one per view, because the table clips to one line and the card to two. Both share a single promise, so that costs extra elements in the payload and **not** a second query.

Small fix carried along: the JS truncation (`slice(0, 64)` / `slice(0, 58)`) is gone. Both call sites already clip in CSS, so the character count did nothing the CSS was not already doing — while cutting by character on a proportional font, which drops text that would have fit.

⚠️ An earlier draft of this entry said the two produced a *doubled ellipsis*. They cannot: `text-overflow` replaces the overflowing tail rather than appending to it. Caught by the audit — the removal was right and the reason written for it was invented, which is exactly what §3.3 says about rationale that nothing in the diff records.

> ⚠️ **Each stage of §16.1 opens with a discussion, not with code.** A finished stage is not authorisation to start the next one — see the decision-log entry for 2026-08-20. Do not pick up Stage C because Stage B closed.

---

**§16.2 shipped in full, 2026-08-21 — all six items.** The project dashboard now follows the same read pattern as the org overview.

**1–3, the §1/§2 debt.** `aggregations.service.ts` had zero tests; it has 26 integration tests against a `DASH` fixture project whose counts (10 error/api, 9 warn/worker, 2 info/cron) make ordering *as text* and *as a number* disagree on the **first** element. Twenty-one events expose both `ORDER BY` defects.

Both were fixed with the failing test written first — all three targeted tests failed against the old code. The one that mattered was `topSources`: it applies a `LIMIT`, so a lexicographic sort did not merely mis-order the list. Asking for the top 2 of api (10), worker (9), cron (2) returned **worker and cron**, dropping the busiest source entirely. `environmentBreakdown()` and its widget were deleted rather than fixed — they carried the third occurrence and were rendered nowhere.

`parseRange` went from two implementations and three preset lists to one of each, with `DASHBOARD_PRESETS` **derived** from the schema rather than restated. `export const dynamic = "force-dynamic"` went too; the build still reports the route as `ƒ (Dynamic)`.

**4, streaming.** `DashboardPage` is a Server Component, the route hands down six unawaited promises, every widget is its own `Suspense` boundary. Verified by delaying `topMessages` three seconds: the page started streaming at **318 ms** while the stream stayed open to 3196.

⚠️ **That conversion found a live defect nobody was looking for.** `DashboardPage` called `useAutoRefresh()` *and* rendered `DashboardHeader`, which renders `AutoRefreshControl`, which calls `useAutoRefresh()`. Two intervals, two `router.refresh()` per tick — **the dashboard reloaded itself twice as often as the setting said**, doubling its own database load on the page this workstream exists to make cheaper. No test here could have caught it: there are zero `.test.tsx` and a duplicated `setInterval` is invisible to every other kind. A Server Component cannot hold a hook, so the fix is structural rather than a deletion someone has to remember.

**5, the rollup.** `eventsPerMinute`, `levelBreakdown` and `hasAnyEvents` read `by_level` — no migration. The boundary moved to `shared/services/rollup-boundary.service.ts` rather than being copied, reviving a folder empty since 2026-08-13, and gained a guard the overview's private copy lacked: a project absent from `rollup_state` used to inherit another project's watermark and then contribute no summary rows below it.

⚠️ **Those tests are in `event-rollup.service.itest.ts`, not beside the service.** The shared fixture never builds a rollup, so `rollupBoundary` is null there and every read falls back to raw `events` — tests written next to the service would have passed without executing one line of the new code, which is this repository's recorded failure mode twice over. Confirmed by breaking the rollup CTE deliberately: exactly one test failed.

**6, the cache.** `dashboard-cache.service.ts` over the same primitive, keyed by project id and preset. `hasAnyEvents` is excluded on purpose. Verified with `pg_stat_statements`: a second load leaves every aggregation at one call. An auto-refresh tick then costs only the uncached remainder — the gate plus the org, membership, project and alert-rule lookups — rather than six aggregations. Cheap, not free.

**Three things moved to `shared/` rather than being copied** — the rollup boundary, the cache key builder (`query-cache-key.ts`) and the TTL settings (`read-cache-settings.ts`). Copying a cache-key builder in particular would have duplicated an authorization boundary, which is the worst instance of a pattern that had already cost this repository three separate defects in two days.

**Totals:** 726 unit · 112 integration · 73 e2e.

**Still open on this page:** `topMessages` (170 ms) and `recentErrors` cannot leave raw `events`; `topSources` needs a `by_source` rollup column, deferred until measured at 30 days. And every number here comes from a 24-hour window on a three-day corpus — the 30-day question is still unanswered for both pages.

## The project dashboard, as planned — [`PLAN.md` §16.2](PLAN.md#162-the-project-dashboard--same-pattern-measured-first)

**Measured 2026-08-21, before planning anything.** `features/dashboard/services/aggregations.service.bench.ts` against the 500k local corpus over a 24-hour window; baseline in `bench/baselines/2026-08-21-local-500k-dashboard.json`.

| query | mean |
|---|---|
| `hasAnyEvents` | 0.79 ms |
| `recentErrors` | 0.84 ms |
| `topSources` | 11.1 ms |
| `levelBreakdown` | 11.6 ms |
| `eventsPerMinute` | 44.2 ms |
| **`topMessages`** | **170.5 ms** |
| fan-out of five, parallel | 169.0 ms |
| what the route does (gate → fan-out) | 170.2 ms |

**`topMessages` is the page** — 170 ms of a 170 ms fan-out, with the other four summing to 67 ms inside its shadow.

⚠️ **A prediction was refuted.** The serialised `hasAnyEvents` gate — awaited *before* the `Promise.all` rather than inside it — was called out as a likely cause of the page's latency before anything was measured. It costs **1.2 ms**, 0.2% of the page. It stays where it is. Written down because the prediction was made out loud and used as an argument.

**Agreed order** — 1 to 3 are §1/§2 debt owed regardless, and nothing touches a query before them:

1. Tests for `aggregations.service.ts` (zero today).
2. The two live `ORDER BY` defects, failing test first; delete the dead `environmentBreakdown()` and its widget.
3. One `parseRange`, out of the route — there are **three** preset lists today (`TIME_RANGE_PRESETS`, `DASHBOARD_PRESETS`, and a hardcoded `Set` in the route, which also holds a second `parseRange`). They agree by coincidence, which is the same shape as the auto-refresh enum drift found earlier the same day.
4. Streaming — everything but `topMessages` at ~44 ms instead of 170.
5. The rollup for `eventsPerMinute`, `levelBreakdown`, `hasAnyEvents`. All from `by_level`; **no migration**.
6. The cache, keyed by project.

**Item 5 is on the list despite the benchmark showing no latency win**, and the reason is a correction to that benchmark rather than a decision against it: 0 ms was measured over a **24-hour window on a three-day corpus**, and `eventsPerMinute` scans in proportion to the window while the rollup form does not. Plus the non-numeric reason — one read pattern instead of two. Both recorded in §17.

`topSources` stays off the list until measured at 30 days: it needs a `by_source` column, which is permanent width on every row for 11 ms today.

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
