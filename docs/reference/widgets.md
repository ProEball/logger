# Widgets

Every read surface in the app, what backs it, and what it costs. Written 2026-08-20 as the inventory step before designing a rollup table (`PLAN.md` §16.1 Stage D) — the point being to decide the rollup's shape from *all* the widgets rather than from the two that happened to come up in conversation.

Useful beyond that: this is the answer to "where does this number come from" without opening three files.

**Cost column**: share of the page's total database time, measured with `pg_stat_statements` on 2026-08-20 against a local 500k-event corpus, *after* the environments registry landed. Shares are per page load, so they say what to attack; they are not durations and do not transfer between machines. The project dashboard has not been measured — nothing there has a share yet.

**Rollup column**: whether a minute-grain rollup keyed `(project, minute)` could serve it. See [Rollup feasibility](#rollup-feasibility) below for what that answer depends on.

---

## Organization overview — `/[org]`

Route: `app/[org]/(org-shell)/page.tsx`. Service: `features/overview/services/overview.service.ts`, reached since 2026-08-20 through `overview-cache.service.ts` — see below. The route makes **six service calls** per load, each handed to its section as an **unawaited promise**.

**The page has six top-level `Suspense` boundaries** — filter bar, KPI row, volume chart, projects panel, top errors, level breakdown — and each appears as soon as its own query returns. Since 2026-08-20 there are more *nested* inside the projects panel: one per project per view for the streaming top-error cell, so an organization with five projects renders 6 + 10. The six are the page's structure; the rest are one column filling in (changed 2026-08-20 — the route used to await all of them before rendering anything). Sections that need the same data receive the same promise, so the query still runs once: the bucket query feeds both the KPI sparklines and the volume chart, and the per-project statistics feed both the KPI row and the projects panel.

That sharing is load-bearing, not an optimisation detail. If a section fetched its own data instead, those two queries would double, and splitting the page for streaming would have made it slower.

**Since 2026-08-20 the route calls `overview-cache.service.ts`, not the service directly.** All six service functions behind the table below are cached in process for 30 seconds, so the Cost column is what one reader pays per 30 s rather than what every reader pays. A second load inside that window issues **none of their queries**; verified with `pg_stat_statements` against the running dev server.

**Six calls, ten statements.** Counted with `pg_stat_statements` on 2026-08-20 against the dev server: one uncached load issues 10 SQL statements across 8 distinct shapes. `getProjectStats` issues three of them (the boundary, the stats query, the environment query); `rollupBoundary` runs three times in total, once each for the stats, the level breakdown and the buckets — deliberately, since threading one boundary through every aggregate buys an accuracy that is identical (see [architecture.md](architecture.md#read-caching)).

The count did **not** rise when the per-project top message was split onto its own call, because that query reads raw `events` only and has no boundary to wait for. Re-measured after the split: still 10 statements, `rollupBoundary` still 3.

Earlier revisions of this line said "six `events` queries per load" and then "five service calls". The first predated the rollup and was never re-measured; the second predated the split.

Say "none of them", not "no queries": the page still issues four uncached calls on every load — `getOrgBySlug`, `getMembership`, `listProjectsForOrg`, and `listAlertRules` once per project. They are cheap and none touches `events`, but a `pg_stat_statements` run will show them, and a reader expecting a literal zero would take that as the cache having broken.

The key is the project scope + the range **preset** + the filters, but only where each of those changes the answer. The environment filter list is keyed on the scope alone, because it does not read the range at all.

Two consequences worth knowing before reading the Cost column:

- **A range change need not miss.** The environment filter list is keyed without a range, and top errors is keyed on its *clamped* window — so switching the page between 7d and 30d re-runs neither, because `clampTopErrorsWindow` maps both to 24h.
- **The cache bounds frequency, not cost.** A query that grows expensive as data accumulates still costs that much once per TTL, and the first reader after a 5-minute staleness ceiling waits for it. The message-keyed rows below are still the ones to attack.
- **Nothing cheap waits for anything expensive.** Until 2026-08-20 the per-project statistics and the per-project top message were one call behind one promise, so the KPI row — four rollup-backed numbers, ~30 ms — sat behind a ~954 ms message aggregation it does not display. They are now separate calls with separate cache entries, and the top-error column streams into its own per-row boundary. This changed no query's cost; it changed what has to finish before the page has something to show.

| Widget | Backed by | Groups by | Responds to | Cost | Rollup |
|---|---|---|---|---|---|
| **Volume chart** (`OrgVolumeChart`) — one series per project | `getOrgEventBuckets` — **rollup + raw tail** since 2026-08-20 | project × epoch-floored bucket | range only — **ignores the environment filter** | 37.6% before the rollup | ✅ done |
| **Environment pills** on each project card | `getProjectStats` (env query) — **rollup + raw tail** since 2026-08-20 | project × environment, `ARRAY_AGG(DISTINCT env)` over the union | range, so the pills change with the filter | 23.8% before the rollup | ✅ done |
| **Top errors across org** | `getOrgTopErrors` — raw `events`, never the rollup | `SUBSTRING(message, 1, 200)` | environment, and its **own** range: `min(page range, 24h)`. Levels are fixed at `error, fatal` and no longer overridable | 11.4%, now the page's bound | ❌ cardinality |
| **Top error per project** (card + table cell) | `getProjectTopMessages` — its own call and its own per-row `Suspense` boundary since 2026-08-20 | project × `SUBSTRING(message, 1, 120)` | range, environment | 10.0% of the share, **~954 ms of the wall clock** | ❌ cardinality |
| **Per-project events / errors / error rate** | `getProjectStats` (stats query) | project | range, environment | 6.3% | ✅ |
| **Level breakdown** | `getOrgLevelBreakdown` — **rollup + raw tail**, but falls back entirely to `events` when an environment filter is active | level | range, environment | 6.0% before the rollup | ✅ done (unfiltered) |
| **Environment filter list** | `getOrgEnvironments` | — | nothing; fixed 30-day window | ~0% | already a registry |
| **KPI: total events / errors / projects** | derived in `buildProjectRows` + `sumProjectRows` | — | — | free | ✅ (follows the stats query) |
| **KPI sparklines** | derived from the volume buckets | — | — | free | ✅ |
| **KPI: firing alerts** | `listAlertRules` per project | — | — | not an `events` query | n/a — `alert_rules` |

One asymmetry remains: the volume chart ignores the environment filter that narrows most other widgets on the page.

There were two. The second — the per-project top error ignoring a level filter that org-wide top errors respected — was closed on 2026-08-20 by **removing the level filter entirely**. It reached three of the eight widgets above and left five visibly unchanged, which reads as broken rather than as scoped; reasoning in `OverviewFilterBar.tsx`. The bar now offers range, environment, and an auto-refresh control.

## Project dashboard — `/[org]/[project]`

Route: `app/[org]/[project]/page.tsx`. Service: `features/dashboard/services/aggregations.service.ts`.

**Measured 2026-08-21** by `aggregations.service.bench.ts` — wall-clock per query rather than shares, against 500k events over a 24-hour window (baseline in `bench/baselines/2026-08-21-local-500k-dashboard.json`).

The numbers below are the state **before** §16.2 shipped, kept because they are what every decision in it rests on. Three of these queries moved to the rollup the same day, so they are a record of the problem rather than a description of the code — the table further down says what backs each widget now.

| query | mean | net of the 0.26 ms round-trip floor |
|---|---|---|
| `hasAnyEvents` | 0.79 ms | 0.5 |
| `recentErrors` | 0.84 ms | 0.56 |
| `topSources` | 11.1 ms | 11.0 |
| `levelBreakdown` | 11.6 ms | 11.3 |
| `eventsPerMinute` | 44.2 ms | 43.1 |
| **`topMessages`** | **170.5 ms** | **169.9** |
| fan-out of five, in parallel | **169.0 ms** | |
| what the route does (gate, then fan-out) | **170.2 ms** | |

`topMessages` **is** the page: the other four sum to 67 ms and run entirely inside its shadow. The serialised `hasAnyEvents` gate — awaited before the fan-out rather than inside it — costs **1.2 ms**, under 1% of the page, and is not worth moving.

That 1.2 ms is the gap between the two page benchmarks (170.2 − 169.0), and it is *inside the run-to-run noise* on a 170 ms measurement: a separate run of the same benchmark put it at 0.4 ms. What the measurement establishes is an upper bound of a millisecond or two, which is enough to settle the question and not enough to quote to two decimals. An earlier revision of this line said 0.38 ms, taken from one run's console output rather than from the committed baseline.

Read the Rollup column below with the window in mind. It says what the rollup *could* serve, not what it would save today: these numbers come from a 24-hour window on a three-day corpus, and the raw-events queries scan in proportion to the window while a rollup read does not.

The five `events` aggregations below are cached in process for 30 seconds by `dashboard-cache.service.ts`, keyed on the project id and the range preset — the same primitive and window the org overview uses.

Say "the five", not "everything": the page also issues `getOrgBySlug`, `getMembership`, `getProjectBySlug`, `listAlertRules` and the `hasAnyEvents` gate on every load, none of them cached. An auto-refresh tick is therefore cheap rather than free — it costs those five small queries instead of six aggregations.

| Widget | Backed by | Groups by | Responds to | Rollup |
|---|---|---|---|---|
| **Events per minute** (stacked area) | `eventsPerMinute` — **rollup + raw tail** since 2026-08-21 | epoch-floored bucket × level | range | ✅ done |
| **Level breakdown** | `levelBreakdown` — **rollup + raw tail** since 2026-08-21 | level | range | ✅ done |
| **Top messages** | `topMessages` — raw `events`, its own `Suspense` boundary | `SUBSTRING(message, 1, 200)` | range | ❌ cardinality |
| **Top sources** | `topSources` — raw `events` | `COALESCE(source, '(unknown)')` | range | ⚠️ needs a `by_source` column; deferred until measured at 30 days |
| **Recent errors** | `recentErrors` — raw `events` | none — returns whole rows | range | ❌ needs rows |
| **KPI row** | derived in `dashboard-kpis.ts` from the buckets, levels and alert rules | — | — | follows its inputs |
| **Alerts panel** | `listAlertRules` | — | — | n/a — `alert_rules` |
| **Empty-project gate** | `hasAnyEvents` — rollup **or** raw `events` | — | — | ✅ done, and deliberately **uncached** |

The gate checks the rollup first because one row per minute is a smaller haystack than the partitioned event table, then falls through to `events` — a project whose first event arrived in the last minute has no rollup row yet and is emphatically not an empty project. It is left uncached for the same reason: the single moment its answer changes is the moment a stale "no events yet" would be worst, and it costs 0.79 ms.

`hasAnyEvents` is awaited **before** the rest, not alongside it, because it decides which page renders at all — the dashboard or the onboarding screen. The read-path audit counted that as a serialised round trip worth removing; measuring it on 2026-08-21 put the cost at **1.2 ms of a 170 ms page**, so it stays.

Since 2026-08-21 the route creates the other five queries as **unawaited promises** and each widget is its own `Suspense` boundary, so nothing waits for `topMessages` — verified by delaying that query three seconds and watching the page still start streaming at 318 ms.

### ~~Dead code~~ — deleted 2026-08-21

`EnvironmentBreakdownWidget` and `environmentBreakdown()` were rendered nowhere and called nowhere; a grep on 2026-08-20 found the only reference to either name inside the widget's own file. Both are gone, along with the `EnvCount` type and the `dashboard.widgets.environmentBreakdown` i18n key.

They carried one of the three `ORDER BY count DESC` text-ordering defects recorded in [logging.md](logging.md#ordering-count-columns-are-cast-to-text) — that one was deleted rather than fixed, since nothing could reach it. The other two, in `levelBreakdown` and `topSources`, were **fixed** the same day once the service had tests that could prove a fix.

(The 2026-08-20 note here also claimed the widget had an orphaned SCSS module. It never had one — it was the only widget in that folder without.)

## Events page — `/[org]/[project]/events`

Service: `features/events/services/events-query.service.ts`.

| Surface | Backed by | Notes | Rollup |
|---|---|---|---|
| **Event list** | `listEvents` | Keyset pagination, 50 per page, fetches 51 to detect `hasMore` | ❌ needs rows |
| **Event drawer** | `getEventById` | `?event=<id>`, not a route | ❌ needs rows |
| **Facet counts** | `getFacetCountsAction` → `getFacetCounts` | **Five aggregations**, loaded **when the filter panel opens** (changed 2026-08-20 — they used to run on every page load, panel open or not) | ⚠️ partial |

Each facet is scoped by *every other* active filter but not its own, so unchecking a box cannot empty its own option list. That is also why facets resist a rollup: the filter set includes full-text message search and JSONB attribute containment, neither of which a fixed-grain rollup can express.

With the counts moved off the page load, **a normal events page is one query** — a keyset page of 51 rows against `(project_id, timestamp, id)`. The five aggregations are paid only by the person who opens the panel, and re-paid on each open, since the counts depend on the filters active at that moment.

Two of the five are usually worth little: on any install with a single release and few error types, `RELEASE` and `ERROR TYPE` each show one option carrying the full event count. Dropping those two is the cheapest remaining win here, and `release` can never come from a rollup — see below.

---

## Rollup feasibility

Splitting the table above by what a `(project, minute)` rollup could actually serve:

**Servable — 74% of the measured overview cost.** Anything that is a count over low-cardinality dimensions: volume buckets, level breakdown, per-project totals, environment counts, source counts, `hasAnyEvents`. Sums over minutes are exact, so these lose nothing.

**Not servable — 21%.** Anything keyed by message. The corpus carries 168k distinct messages against 500k events; a fixed-grain rollup cannot pre-aggregate that, and merging per-minute top-N lists is *approximate*: a message sitting eleventh every minute can be first over the hour and never appear. Since the stated reason for building a rollup is that everyone should see the same numbers, quietly making those numbers wrong would defeat it. Top messages and top errors stay on raw `events`.

**Not servable — anything returning rows.** Recent errors, the event list, the drawer.

**Partially servable.** Facet counts, whenever the active filters are limited to rollup dimensions. With a message search or an attribute filter active, they must fall back to raw events.

### Which dimensions may enter the rollup

The row count is `minutes × projects × (dimension cardinality)`. Every dimension is therefore a multiplier, and the dangerous ones are those a client controls.

| Dimension | Cardinality | Verdict |
|---|---|---|
| `level` | Fixed at 5 | Safe |
| `environment` | Client-supplied, `z.string().max(128)` | Safe **only with a cap** — see below |
| `source` | Client-supplied, in practice a handful | Probably safe, same cap applies |
| `release` | **Changes on every deploy by design** | ❌ Never. This is the dimension that would grow without bound |
| `error_type` | Client-supplied, moderate | Undecided |
| `message` | 168k distinct per 500k events | ❌ |

`release` is the sharpest finding of this inventory. Environment cardinality was the risk everyone noticed; `release` is worse and less obvious, because a release identifier is *supposed* to be new every time. The releases facet must keep reading raw events.

The mitigation for the client-supplied dimensions that do enter: store them as JSON keys inside the `(project, minute)` row rather than as separate rows, and cap the number of keys, folding the rest into `(other)`. A runaway dimension then produces one fat row per minute instead of thousands of rows per minute — a degradation instead of a collapse.
