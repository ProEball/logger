# Widgets

Every read surface in the app, what backs it, and what it costs. Written 2026-08-20 as the inventory step before designing a rollup table (`PLAN.md` §16.1 Stage D) — the point being to decide the rollup's shape from *all* the widgets rather than from the two that happened to come up in conversation.

Useful beyond that: this is the answer to "where does this number come from" without opening three files.

**Cost column**: share of the page's total database time, measured with `pg_stat_statements` on 2026-08-20 against a local 500k-event corpus, *after* the environments registry landed. Shares are per page load, so they say what to attack; they are not durations and do not transfer between machines. The project dashboard has not been measured — nothing there has a share yet.

**Rollup column**: whether a minute-grain rollup keyed `(project, minute)` could serve it. See [Rollup feasibility](#rollup-feasibility) below for what that answer depends on.

---

## Organization overview — `/[org]`

Route: `app/[org]/(org-shell)/page.tsx`. Service: `features/overview/services/overview.service.ts`. Six `events` queries per load (seven before the environments registry), each issued by the route and handed to its section as an **unawaited promise**.

**Each widget below is its own `Suspense` boundary** and appears as soon as its own query returns (changed 2026-08-20 — the route used to await all of them before rendering anything). Sections that need the same data receive the same promise, so the query still runs once: the bucket query feeds both the KPI sparklines and the volume chart, and the summaries feed both the KPI row and the projects panel.

That sharing is load-bearing, not an optimisation detail. If a section fetched its own data instead, those two queries would double, and splitting the page for streaming would have made it slower.

| Widget | Backed by | Groups by | Responds to | Cost | Rollup |
|---|---|---|---|---|---|
| **Volume chart** (`OrgVolumeChart`) — one series per project | `getOrgEventBuckets` — **rollup + raw tail** since 2026-08-20 | project × epoch-floored bucket | range only — **ignores level and environment filters** | 37.6% before the rollup | ✅ done |
| **Environment pills** on each project card | `getProjectSummaries` (env query) | project × environment, `STRING_AGG(DISTINCT …)` | range, so the pills change with the filter | **23.8%** | ✅ with per-env counts |
| **Top errors across org** | `getOrgTopErrors` — raw `events`, never the rollup | `SUBSTRING(message, 1, 200)` | levels, environment, and its **own** range: `min(page range, 24h)` | 11.4%, now the page's bound | ❌ cardinality |
| **Top error per project** (card + table cell) | `getProjectSummaries` (ranked CTE) | project × `SUBSTRING(message, 1, 120)` | range, environment — **not levels**, see [logging.md](logging.md#known-inconsistency-level-filter-and-the-per-project-top-message) | 10.0% | ❌ cardinality |
| **Per-project events / errors / error rate** | `getProjectSummaries` (stats query) | project | range, levels, environment | 6.3% | ✅ |
| **Level breakdown** | `getOrgLevelBreakdown` — **rollup + raw tail**, but falls back entirely to `events` when an environment filter is active | level | range, environment | 6.0% before the rollup | ✅ done (unfiltered) |
| **Environment filter list** | `getOrgEnvironments` | — | nothing; fixed 30-day window | ~0% | already a registry |
| **KPI: total events / errors / projects** | derived in `buildProjectRows` + `sumProjectRows` | — | — | free | ✅ (follows the stats query) |
| **KPI sparklines** | derived from the volume buckets | — | — | free | ✅ |
| **KPI: firing alerts** | `listAlertRules` per project | — | — | not an `events` query | n/a — `alert_rules` |

Note the two asymmetries, both deliberate-looking but undocumented until now: the volume chart ignores the level and environment filters that narrow every other widget on the page, and the per-project top error ignores the level filter that the org-wide top errors respects.

## Project dashboard — `/[org]/[project]`

Route: `app/[org]/[project]/page.tsx`. Service: `features/dashboard/services/aggregations.service.ts`. **Not measured** — no `pg_stat_statements` run has covered this page.

| Widget | Backed by | Groups by | Responds to | Rollup |
|---|---|---|---|---|
| **Events per minute** (stacked area) | `eventsPerMinute` | epoch-floored bucket × level | range | ✅ |
| **Level breakdown** | `levelBreakdown` | level | range | ✅ |
| **Top messages** | `topMessages` | `SUBSTRING(message, 1, 200)` | range | ❌ cardinality |
| **Top sources** | `topSources` | `COALESCE(source, '(unknown)')` | range | ✅ if `source` is added |
| **Recent errors** | `recentErrors` | none — returns whole rows | range | ❌ needs rows |
| **KPI row** | derived from the above | — | — | follows its inputs |
| **Alerts panel** | `listAlertRules` | — | — | n/a — `alert_rules` |
| **Empty-project gate** | `hasAnyEvents` | — | — | ✅ trivially |

`hasAnyEvents` is awaited **before** the `Promise.all`, not inside it — it is the fifth serialised round trip the read-path audit counts.

### Dead code

**`EnvironmentBreakdownWidget` is rendered nowhere and `environmentBreakdown()` is called nowhere.** Verified 2026-08-20 by grep across `app/`, `features/` and `shared/`: the only reference to either name is inside the widget's own file. The component, its SCSS module, and the service function are unreachable.

Worth knowing before acting on it: one of the three `ORDER BY count DESC` text-ordering bugs recorded in [logging.md](logging.md#ordering-count-columns-are-cast-to-text) is in `environmentBreakdown`, so that one cannot affect anyone. The other two (`levelBreakdown`, `topSources`) are live.

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
