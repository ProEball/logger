# Widgets

Every read surface in the app, what backs it, and what it costs. Written 2026-08-20 as the inventory step before designing a rollup table (`PLAN.md` §16.1 Stage D) — the point being to decide the rollup's shape from *all* the widgets rather than from the two that happened to come up in conversation.

Useful beyond that: this is the answer to "where does this number come from" without opening three files.

**Cost column**: share of the page's total database time, measured with `pg_stat_statements` on 2026-08-20 against a local 500k-event corpus, *after* the environments registry landed. Shares are per page load, so they say what to attack; they are not durations and do not transfer between machines. The project dashboard has not been measured — nothing there has a share yet.

**Rollup column**: whether a minute-grain rollup keyed `(project, minute)` could serve it. See [Rollup feasibility](#rollup-feasibility) below for what that answer depends on.

---

## Organization overview — `/[org]`

Route: `app/[org]/(org-shell)/page.tsx`. Services: `shared/services/event-aggregations.service.ts` for the buckets, level breakdown and top errors — the same functions the project dashboard calls, scoped to several projects instead of one — plus `features/overview/services/overview.service.ts` for what is still overview-only. Both reached through `overview-cache.service.ts` since 2026-08-20 — see below. The route makes **six service calls** per load, each handed to its section as an **unawaited promise**.

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
| **Error-ratio chart** (`EventChart`, line mode) — one series per project | `eventBuckets` (shared) — **rollup + raw tail**, filtered or not. Reads `total` and the generated `errors` column, never `by_level`: the jsonb path costs 8× and this chart draws two numbers | project × epoch-floored bucket | range **and environment**, since 2026-08-25 | 37.6% before the rollup | ✅ done |
| **Environment pills** on each project card | `getProjectStats` (env query) — **rollup + raw tail** since 2026-08-20 | project × environment, `ARRAY_AGG(DISTINCT env)` over the union | range, so the pills change with the filter | 23.8% before the rollup | ✅ done |
| **Top errors across org** | `topMessages` (shared, `levels: [error, fatal]`, limit 5) — **template rollup + raw tail** since 2026-08-24 where no environment filter is active, raw `events` otherwise | `template_hash`, or `SUBSTRING(message, 1, 200)` on the fallback | environment, and its **own** range: `min(page range, 24h)`. Levels are fixed at `error, fatal` and no longer overridable | 11.4% before the rollup | ✅ done (unfiltered) |
| **Top error per project** (card + table cell) | `getProjectTopMessages` — **template rollup + raw tail** since 2026-08-23 where no environment filter is active, raw `events` otherwise; its own call and its own per-row `Suspense` boundary since 2026-08-20 | project × `template_hash`, or `SUBSTRING(message, 1, 120)` on the fallback | range, environment | was 10.0% and ~954 ms; **19 ms** on the rollup path | ✅ done (unfiltered) |
| **Per-project events / errors / error rate** | `getProjectStats` (stats query) | project | range, environment | 6.3% | ✅ |
| **Level breakdown** | `levelBreakdown` (shared) — **rollup + raw tail**, filtered or not, since `environment` joined the rollup key on 2026-08-25 | level | range, environment | 6.0% before the rollup | ✅ done (unfiltered) |
| **Environment filter list** | `getOrgEnvironments` | — | nothing; fixed 30-day window | ~0% | already a registry |
| **KPI: total events / errors / projects** | derived in `buildProjectRows` + `sumProjectRows` | — | — | free | ✅ (follows the stats query) |
| **KPI sparklines** | derived from the volume buckets | — | — | free | ✅ |
| **KPI: firing alerts** | `listAlertRules` per project | — | — | not an `events` query | n/a — `alert_rules` |

**No asymmetries remain (2026-08-25).** The last one — the volume chart ignoring the environment filter — was closed by merging `getOrgEventBuckets` and the project dashboard's `eventsPerMinute` into one `eventBuckets` in `shared/services/`. The merge is what made it cheap to close: the org query had no `environments` parameter *at all*, so adding one was not a fix to be scheduled but a column the merged query already had to carry. Under a filter it reads raw `events`, since `by_env` and `by_level` are separate marginals and cannot answer a joint question; measured at 15–17 ms on 500k events, the same order as the unfiltered path on that corpus.

There were two before that. The second — the per-project top error ignoring a level filter that org-wide top errors respected — was closed on 2026-08-20 by **removing the level filter entirely**. It reached three of the eight widgets above and left five visibly unchanged, which reads as broken rather than as scoped; reasoning in `OverviewFilterBar.tsx`. The bar now offers range, environment, and an auto-refresh control.

**The bar gained a pending state on 2026-08-25.** Until then it called `router.push()` bare, so a click produced no visible change until the server answered — the pill did not restyle and no skeleton appeared, because a transition deliberately holds the current UI. The project dashboard had the identical defect fixed on 2026-08-22; the fix lived inside that feature's own hook and was never carried here. The mechanism is now `shared/hooks/use-filter-params.ts`, used by both, and the pills dim after a 120 ms delay so a navigation faster than that never flickers.

It was found by measuring rather than by looking: the filtered benchmarks below put the whole page at 19 ms and the unfiltered one at 25 ms on a 500k-event corpus, which cannot produce a wait anybody would report. The wait was the absence of feedback. Recorded because the first hypothesis was that the environment filter was slow, and the measurement said the opposite.

## Project dashboard — `/[org]/[project]`

Route: `app/[org]/[project]/page.tsx`. Service: `shared/services/event-aggregations.service.ts` — shared with the organization overview since 2026-08-25, called with a one-project scope.

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
| **Top messages** | `topMessages` (shared, every level, limit 10) — template rollup where covered, raw `events` otherwise; its own `Suspense` boundary | `template_hash`, or `SUBSTRING(message, 1, 200)` on the fallback | range | ✅ since 2026-08-23, by template |
| **Top sources** | `topSources` — **rollup + raw tail** since 2026-08-24, raw `events` where `by_source` is missing | `by_source` keys, or `COALESCE(source, '(unknown)')` on the fallback | range | ✅ done |
| **Recent errors** | `recentErrors` — raw `events` | none — returns whole rows | range | ❌ needs rows |
| **KPI row** | derived in `dashboard-kpis.ts` from the buckets, levels and alert rules | — | — | follows its inputs |
| **Live rate** — *top bar, not this page* | `eventsInLastMinute` — raw `events`, trailing 60 s | none: one count | **nothing**; see below | ❌ needs the current minute |
| **Alerts panel** | `listAlertRules` | — | — | n/a — `alert_rules` |
| **Empty-project gate** | `hasAnyEvents` — rollup **or** raw `events` | — | — | ✅ done, and deliberately **uncached** |

The gate checks the rollup first because one row per minute is a smaller haystack than the partitioned event table, then falls through to `events` — a project whose first event arrived in the last minute has no rollup row yet and is emphatically not an empty project. It is left uncached for the same reason: the single moment its answer changes is the moment a stale "no events yet" would be worst, and it costs 0.79 ms.

`hasAnyEvents` is awaited **before** the rest, not alongside it, because it decides which page renders at all — the dashboard or the onboarding screen. The read-path audit counted that as a serialised round trip worth removing; measuring it on 2026-08-21 put the cost at **1.2 ms of a 170 ms page**, so it stays.

Since 2026-08-21 the route creates the other five queries as **unawaited promises** and each widget is its own `Suspense` boundary, so nothing waits for `topMessages` — verified by delaying that query three seconds and watching the page still start streaming at 318 ms.

### The live rate is in the layout, so it is not a dashboard widget

It is listed above because a reader looking for "where does the events / min number come from" will look here, not because `app/[org]/[project]/page.tsx` issues it. `app/[org]/[project]/layout.tsx` does, which means it renders on **every** project page — events, alerts, API keys, settings — and that it responds to no filter at all: a layout cannot read `searchParams` in the App Router, so neither the range presets nor the environment pills reach it. It counts the whole project over the last sixty seconds. Read it as a heartbeat, not as a statistic about the view.

It also does not re-read on its own. A shared layout is preserved across navigation between its children, so the number updates when the page re-renders — an auto-refresh tick or a reload — and on the settings pages, which have no refresh control, it is a snapshot from arrival.

It has its own cache profile: **10 seconds**, not the 30 the aggregations use, because a 30-second TTL on top of a 30-second refresh interval would let a "last minute" reading describe a minute that ended ninety seconds ago. The query is a `COUNT(*)` over one partition's tail and does not touch the rollup — one minute of events is exactly the window the rollup has not summarised yet.

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

### `topMessages` no longer uses `mode()`

Changed 2026-08-22. The widget's level badge was computed with `mode() WITHIN
GROUP (ORDER BY level)`. That is an **ordered-set aggregate**, and one in the
select list makes `HashAggregate` unavailable to the planner at any `work_mem` —
the whole query was pinned to sort-then-group over every matching row. The plan
proves it: under `enable_sort=off`, which prices every sort at ten billion, the
planner took the penalty and sorted anyway.

Measured on staging at 8.9M events over a 7-day range: **26,855 ms with `mode()`,
17,021 ms without**, the plan gaining `Partial HashAggregate` with `Batches: 1`
and no spill. Full evidence, including the three hypotheses this refuted, in
[`PLAN.md` §16.3](../PLAN.md).

It now selects five `COUNT(*) FILTER (WHERE level = …)` counters — ordinary
aggregates, which hash fine — and `pickDominantLevel` picks the badge in
TypeScript.

**The tie-break changed, deliberately.** `mode()` resolves equal frequencies
arbitrarily; `pickDominantLevel` resolves them toward the **more severe** level,
because a widget answering "what should I look at" should point at the thing more
worth looking at. `TopMessage.dominantLevel` is also now the level union rather
than `string`, which removed a cast in `TopMessagesWidget`.

The five levels are restated in the SQL rather than derived from `EVENT_LEVELS`,
since deriving would mean generating column aliases into raw SQL. The drift that
risks is covered by an integration test that iterates `EVENT_LEVELS` and asserts
every one comes back as some message's badge — a level added to the schema and
forgotten in the query leaves that message with no positive count, and
`pickDominantLevel` throws rather than badging it wrongly.

**This is 40% of the problem, not the whole of it.** Seventeen seconds is still
seventeen seconds, and it grows with the corpus. The structural answer is in
§16.3.

### `topMessages` has two implementations, chosen by coverage

Since 2026-08-23. Where the **template rollup** covers the requested range, the
widget groups pre-aggregated rows by a `bigint` fingerprint. Where it does not,
it groups `SUBSTRING(message, 1, 200)` over raw `events` — the query that has
always backed this widget.

| | rollup path | fallback |
|---|---|---|
| reads | `event_template_rollup` + raw tail (≤1 minute) | `events` over the whole range |
| groups by | `template_hash` (`bigint`) | 200 characters of text |
| at 8.9M events, 7 days | ~899k rows → ~18k groups | 4.5M rows → 1.13M groups, **~17 s** |
| displays | the template, `User *** signed in` | the raw message, `User u_487 signed in` |

**The fallback is not a safety net that never fires.** Events ingested before
`template_hash` shipped carry no fingerprint, so every range reaching into that
history takes the slow path and will until 30-day retention rolls them out.
Removing it would silently drop every older message from the list.

That difference in *displayed text* is also what makes the two paths testable
against each other. An earlier version of the integration tests used a fixture
whose message and template were the same string; both paths returned identical
rows, and disabling the rollup branch entirely still passed. See
`event-rollup.service.itest.ts`.

The row shape is unchanged, so `TopMessagesWidget` did not move. `dominantLevel`
comes from `pickDominantLevel` on both paths.

### The rollup path stopped reading jsonb (2026-08-24)

Both rollup readers — the dashboard's `topMessages` and the overview's
per-project top message — used to expand `by_level` with
`jsonb_each_text`, which multiplies every rollup row by up to five and parses
JSON per row. Measured on the resized host: **547 ms at 0% `blk_read_time`**,
i.e. entirely CPU, so no amount of memory would have moved it.

Migration 0012 adds five **generated** `n_<level>` columns, and the readers sum
those instead. Three things fall out at once: no lateral, no JSON parse, and one
row per template rather than one per `(template, level)` — which removes the
self-join both queries needed to re-attach level counts to the top N.

The raw tail keeps its five `COUNT(*) FILTER` counters, since raw `events` has
a `level` column and nothing to unpack.

⚠️ **Both branches count levels, and only one of them was tested.** Every
level-drift test took a range ending at the coverage ceiling, so the tail window
was empty and its counters never executed — replacing the tail's `fatal` filter
with a literal zero broke nothing. There are now per-level tests on *both*
branches in `event-rollup.service.itest.ts`, the tail's writing events above the
ceiling on purpose and asserting the rollup holds none of them first.

## Loading states, and why they are a diagnostic

Both dashboards give **every widget its own `Suspense` boundary**. That is a
deliberate constraint, not an implementation detail: each skeleton disappears
the moment its own query returns, so a cell still showing a skeleton is a slow
query — visible to anyone looking at the page, without a profiler and without
`pg_stat_statements`. Measured on staging at 5.5M events, a 30-day project
dashboard fills five of its six widgets in under 300 ms and leaves `topMessages`
holding its cell for roughly seventeen seconds.

**Re-measured 2026-08-24** at 9.6M events, after the host was resized to 8 GB /
4 vCPU and Postgres given a sized configuration (`PLAN.md` §17). Five cold page
loads, 36 s apart so no cache entry survives:

| page | first chunk | complete |
|---|---|---|
| org overview | 210 ms | 272 ms |
| dashboard 24h | 220 ms | 701 ms |
| dashboard 30d | 162 ms | 1,699 ms |
| dashboard 7d | 187 ms | 1,796 ms |

The shape is unchanged and the diagnostic still reads the same way — the page
starts streaming at ~190 ms and **two** cells hold, one to ~1.3 s and one to
~1.8 s. `pg_stat_statements` names them without ambiguity: `topSources`
(1,207 ms mean, **41%** of its time in `blk_read_time`) and `topMessages` off the
template rollup (804 ms, **0%** — entirely CPU, see §17 on `by_level` being
jsonb). Every other query on both pages is at 0% I/O.

So the seventeen seconds above is a record of the old host, not of the current
code. Kept because §16.2 and §16.3 were both argued from it.

⚠️ **Do not group widgets under a shared boundary.** It is tempting whenever two
widgets share a row, and it makes them all wait for the slowest — which costs
the fast ones their early paint and throws the signal above away. That matters
more as widgets are added, not less.

### Two entry paths, and they behave differently

Streaming per widget applies to a **document load**. A client-side navigation —
clicking a project in the sidebar, or a range chip — is wrapped in a React
transition, and a transition deliberately does *not* show `Suspense` fallbacks:
it holds the current UI rather than flashing back to skeletons. What gives a
navigation an immediate loading state is the segment `loading.tsx`.

| route | `loading.tsx` | renders |
|---|---|---|
| `/[org]` | added 2026-08-22 | `OverviewSkeleton` |
| `/[org]/[project]` | yes | `DashboardSkeleton` (was the generic `PageSkeleton`) |

The overview had **none** until 2026-08-22, so navigating into it held the
previous page on screen, unchanged, until the whole RSC payload was ready —
four to five seconds on staging with no indication anything had been clicked.
The §16.1 streaming work was invisible on that path, because it only ever
applied to a document load.

Both skeletons now **mirror their page layout** rather than showing a generic
placeholder, and both import the page stylesheet instead of restating its grid,
so the two cannot drift. The handover from the route fallback to the page's own
per-widget fallbacks is then seamless: cells fill in one at a time from the
first frame, instead of a grey page being replaced wholesale by a differently
shaped one.

### Switching the range: fixed on the control, still absent on the widgets

Switching the range *within* a page is not a document load, so none of the above
applies to it. The App Router does not commit a URL until the new payload is
ready, and the chips read their selection from `useSearchParams()` — so until
2026-08-22 the clicked chip did not restyle either. Measured before the fix:
thirty DOM samples over twenty-eight seconds after a chip click, zero skeletons
of any kind, `location.search` unchanged throughout. The complaint was not "the
page is slow" but "the button does nothing", and that is what it did.

**The control now answers immediately.** `useDashboardRange` returns
`displayRange` — the committed range, overridden by the clicked one while a
switch is in flight — and `isPending` from `useTransition`. Measured after, with
an artificial delay: the chip goes active at **255 ms** with `aria-busy="true"`,
while the URL is still on the old range; the URL commits at 8252 ms and the busy
state clears. The hint is debounced by 120 ms of CSS animation delay, following
Next's own guidance on pending navigation, so a 1h switch that settles in ~250 ms
never flashes it.

The optimistic value is cleared by comparing the committed range against the
previous one during render, not by watching `isPending`. A transition can settle
without the URL having changed — a rejected navigation, or a push to the range
already selected — and clearing on `isPending` would then leave the control
showing a selection the page never loaded.

**Still absent: the widgets themselves show nothing during a range switch.** The
boundaries are not remounted, so the resolved widgets stay on screen with stale
numbers until the new ones arrive. That was the second half of the fix and it was
deliberately not done: forcing a remount with a `key` would make the chart
collapse to a skeleton on *every* switch, including the 1h one that returns in
250 ms, and trading a correct fast path for a corrected slow one needs a number
that nobody has measured yet. The control being responsive removes the part that
read as broken; the rest reads as slow, which it is.

### Reproducing loading states locally

There is no data volume on a developer machine that makes these visible — every
query returns in milliseconds. Stagger artificial delays instead. Two things
are easy to get wrong:

- **Delay at both levels.** `loading.tsx` is only on screen while the route
  *prologue* runs, so slowing the widget queries alone shows the per-widget
  fallbacks and never the route one.
- **Bypass the cache**, or the second load skips the delay and measures nothing.

Different delays per widget is what makes the ordering legible: the widgets
should appear one at a time, slowest last. That is also the cheapest way to
confirm the boundaries really are per widget and have not been quietly grouped.

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
