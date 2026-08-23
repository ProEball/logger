# Logging Model: Events, Filtering, Dashboard, Alerts

This is the product's core domain: what a "log" (called an **event** throughout the code) looks like, how it's typed, how it's queried, and what's built on top of it (dashboard, alerts).

## The `events` table

See [architecture.md](architecture.md#events-partitioning) for partitioning/retention mechanics. Full column list:

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | uuid | no | server-generated |
| `project_id` | uuid | no | FK → `projects.id`, `ON DELETE RESTRICT` |
| `timestamp` | timestamptz | no | **partition key** |
| `level` | text | no | `debug｜info｜warn｜error｜fatal` (enforced by Zod at ingest — no DB check constraint) |
| `message` | text | no | |
| `source` | text | yes | |
| `environment` | text | yes | |
| `release` | text | yes | |
| `user_id` | text | yes | correlation id, not a real FK |
| `session_id` | text | yes | |
| `request_id` | text | yes | |
| `trace_id` | text | yes | |
| `error_type` | text | yes | |
| `stack_trace` | text | yes | |
| `attributes` | jsonb | default `{}` | flat map, primitive values only |
| `context` | jsonb | default `{}` | free-form nested JSON |
| `user_agent` | text | yes | server-filled from the request, never client-supplied |
| `ip` | text | yes | server-filled from `x-forwarded-for` (first hop), never client-supplied |

Indexes: `(project_id, timestamp)`, `(project_id, level, timestamp)`, `(project_id, error_type, timestamp) WHERE error_type IS NOT NULL`, plus `GIN` on `attributes` and `GIN` on `to_tsvector('simple', message)` (full-text search) — the two GIN indexes exist only in the raw SQL migration, not in the Drizzle schema file.

For the ingest-time validation rules (required fields, size limits, timestamp policy), see [api.md](api.md#event-schema) — that's the authoritative contract for what an event can contain when it arrives.

## Attribute type enforcement

`attributes` is a flat `key → string|number|boolean|null` map. To keep it queryable with `attributes @> '{"key":"value"}'::jsonb` containment filters (used by both the events-list filter UI and alert conditions), the app enforces that **each attribute key has one consistent value type per project**, first-write-wins:

1. `attribute_key_types` (see [architecture.md](architecture.md#attribute-type-registry)) records the first JSON type ever seen for `(project_id, key)`. `null` values never establish or violate a key's type.
2. On every ingest call, incoming events' attribute values are compared against the registered type for their key. A mismatch is an **attribute type conflict**.
3. **Single-event ingest**: any conflict rejects the whole event (`400`, see [api.md](api.md)).
4. **Batch ingest**: conflicting events are filtered out individually; the rest of the batch is still inserted (partial success, `207`).

Example: if the first event ever ingested for a project sends `attributes: { "http_status": 200 }` (number), a later event sending `attributes: { "http_status": "200" }` (string) for the same project will be rejected as a type conflict — rename the key or fix the client instead of relying on implicit coercion.

## Events list: filtering, search, pagination

Filter shape (`EventFilters`, shared between the events-list UI and alert rule conditions):

```ts
{
  range: "15m" | "1h" | "6h" | "24h" | "7d" | "30d" | { from: string; to: string };
  levels?: EventLevel[];
  environments?: string[];
  sources?: string[];
  releases?: string[];
  errorTypes?: string[];
  userId?: string;        // exact match, single value
  sessionId?: string;
  requestId?: string;
  traceId?: string;
  message?: string;       // full-text search
  attributes?: { key: string; value: string }[];  // ANDed
}
```

- **Multi-select filters** (levels, environments, sources, releases, errorTypes) → SQL `IN (...)`.
- **Correlation filters** (userId/sessionId/requestId/traceId) → exact equality, one value at a time.
- **Full-text message search** → `to_tsvector('simple', message) @@ websearch_to_tsquery('simple', $q)`, supports `websearch_to_tsquery` syntax (quoted phrases, `-exclude`).
- **Attribute filters** → `attributes @> '{"key":"value"}'::jsonb`, one clause per filter, ANDed — narrows further with each added filter.
- Filter state lives entirely in the URL and never throws on malformed input (invalid values are silently dropped), so stale/malformed share links still render something sensible.
- **Facet counts**: for each of levels/environments/sources/releases/errorTypes, the UI shows a per-option count scoped by *every other* active filter (but not that field's own filter, so unchecking a box doesn't zero out its own option list). Text facets cap at the top 20 options; `NULL` values are shown as `"(unset)"`.

  **Loaded when the filter panel opens, not with the page** (changed 2026-08-20). These are five aggregations over the whole filtered range, and until then they ran inside the events route's `Promise.all` on every load — including auto-refreshes, and including the great majority of loads where nobody opens the panel, since `FiltersPopover` keeps its open state in client `useState` and the server never learned of it. A normal events page is now a single query: one keyset page of 51 rows.

  They are re-fetched on **every** open rather than cached, because the counts are scoped by the active filters and those change between openings. The fetch goes through `getFacetCountsAction`, which re-checks session and `events.read` — a Server Action is a public endpoint, so the page's own membership check does not cover it. If it fails, the panel still filters; only the numbers are missing, and it says so.

**Pagination** is cursor-based (keyset, not offset): page size 50, `WHERE (timestamp, id) < (cursor_ts, cursor_id) ORDER BY timestamp DESC, id DESC`, fetching 51 rows to detect `hasMore`. Changing any filter resets the cursor. There is no total count shown — only "50" or "50+".

## Dashboard

Per-project metrics (`features/dashboard/services/aggregations.service.ts`, raw SQL aggregation queries scoped by `project_id` + time range):

- **KPI row**: Events/min (rate + sparkline), Errors (error+fatal count), Fatal (fatal-only count), Firing alerts (count + up to 3 rule names).
- **Events-per-minute chart**: stacked area, colored by level, only rendering levels actually present in the data.
- **Level breakdown**: counts per level, click-through to the events list pre-filtered by that level.
- **Recent errors**: latest error/fatal events.
- **Top sources** / **Top messages**: grouped counts (messages truncated to 200 chars for grouping; each group shows `latestAt` and the statistical mode of its levels).

### Bucket sizing

Chart resolution adapts to the selected time range (`pickBucket()`):

| Range | Bucket width |
|---|---|
| ≤ 1h | 1 minute |
| ≤ 24h | 1 hour |
| ≤ 7d | 12 hours |
| else (30d) | 1 day |

Bucketing uses epoch-floor arithmetic (`to_timestamp(floor(extract(epoch from timestamp)/secs)*secs)`) rather than `date_trunc`, because `date_trunc` can't express a 12-hour bucket width directly.

> **Doc drift note**: the original design doc (`docs/features/05-dashboard.md`) specifies a 5-tier bucket scheme (`1m/5m/15m/1h/4h`) — the shipped implementation uses only 4 tiers as shown above. If you're consulting the feature doc for bucket behavior, trust this table instead.

### Zero-fill

The aggregation query only returns buckets that had at least one event (sparse result set). `fillBuckets()` walks every bucket boundary across the full requested range and inserts `{ total: 0 }` entries for any missing bucket, so charts show a continuous line/area that visibly drops to zero during quiet periods instead of just stopping short.

## Organization overview

Cross-project rollup at `/[org]` (`features/overview/services/overview.service.ts`, five raw-SQL aggregations scoped by a list of `project_id`s + time range). URL parsing and row assembly live in `features/overview/utils/`, not in the route.

- **KPI row**: total events, errors + fatals, firing alerts (plus total enabled rules), project count. The first two carry a sparkline built from the volume buckets summed across projects.
- **Volume chart**: one series per project.
- **Projects**: cards by default, switchable to a table. **A project with no events in the range still gets a row, showing zeros** — dropping it would make a quiet project look deleted.
- **Top errors across org**: `error`/`fatal` grouped by `SUBSTRING(message, 1, 200)`, top 5, each attributed to a project via `mode() WITHIN GROUP (ORDER BY project_id)` — so a message occurring in several projects is labelled with only one of them.
- **Level breakdown**: counts per level. Rendered in severity order (`fatal → debug`) by the component, not in the order the query returns.

### Bucket sizing

The overview uses its **own** table (`OVERVIEW_BUCKET_SECONDS`), which does not match the project dashboard's `pickBucket()`:

| Range | Overview | Project dashboard |
|---|---|---|
| 15m | 60s | 60s |
| 1h | 300s | 60s |
| 6h | 900s | 3600s |
| 24h | 3600s | 3600s |
| 7d | 6h | 12h |
| 30d | 1d | 1d |

The overview plots one series per project, so it trades resolution for a readable point count. Two bucketing rules in one app is a wart rather than a design; unifying them changes what the chart shows and is deliberately left to the read-path workstream (`PLAN.md` §16.1) rather than done as a refactor.

### Ordering: count columns are cast to text

These aggregations return counts as `COUNT(*)::text` (to avoid `bigint` serialisation), and **`ORDER BY count DESC` would bind to that text alias**, sorting lexicographically — `"9"` ranks above `"10"`. Where the query also has a `LIMIT`, that returns the *wrong rows*, not merely the right rows misordered.

Fixed 2026-08-20 in `getOrgTopErrors` and `getOrgLevelBreakdown` by ordering on `COUNT(*)` instead; covered by `e2e/overview.spec.ts` ("orders top errors by count, not by the text of the count"), whose fixture deliberately uses counts of 10 and 9 because any pair below 10 hides the bug.

**Fixed everywhere 2026-08-21.** The three remaining occurrences were in `features/dashboard/services/aggregations.service.ts`: `levelBreakdown`, `topSources` and `environmentBreakdown`. The first two now order on the aggregate; the third was deleted with its widget, which had been rendered nowhere since before the audit.

What kept them alive for a day was not difficulty — the fix is one identifier — but that nothing could prove it. `PLAN.md` §17 recorded the decision explicitly: fix it only where a test can demonstrate it, because a service with no tests is a service where a "fix" is a guess. `aggregations.service.itest.ts` closed that, and the three tests targeting these defects **failed against the old code before passing against the new** — the fixture project uses counts of 10, 9 and 2, whose text and numeric orderings disagree on the *first* element.

`topSources` was the one that mattered. It applies a `LIMIT`, so the lexicographic sort did not merely mis-order the list: asking for the top 2 of `api` (10), `worker` (9) and `cron` (2) returned `worker` and `cron`, dropping the busiest source entirely.

⚠️ One trap survives the fix. `levelBreakdown` now reads the rollup unioned with a raw tail, so it re-aggregates — and `ORDER BY COUNT(*)` would be wrong there too, for a different reason: the count it needs is `SUM(n)` over the union, not a count of union rows. Ordering on the alias, on `COUNT(*)`, or on `SUM(n)` are three different queries and only the last is right.

### The rollup

Volume and level counts on the organization overview come from **`event_rollup_minutes`**, a per-minute summary rebuilt from `events` by the `event-rollup` job every minute — not from aggregating `events` on each page load.

**Why a scheduled rebuild rather than counters maintained at ingest.** Incremental counters drift: a lost update, a rollback, a race, and the number is quietly wrong with nothing to detect it. A periodic rebuild reconstructs each bucket from the source, so error cannot accumulate — the worst case is one stale interval, corrected on the next run. It also keeps the ingest path free of contention on hot counter rows, and makes cost a function of the schedule rather than of the ingest rate.

**Everyone sees the same numbers — for closed minutes.** This is the part that is not about speed. Before the rollup, two people opening the same dashboard seconds apart each aggregated over their own `now()`, so *every* figure could differ. They now share the rollup's snapshot, and `computed_at` records when it was taken.

The agreement stops at `rolled_up_to`: the raw tail above it is still computed per request, so the newest minute can differ between two viewers by whatever arrived between their page loads. That is the price of the tail, and it is worth paying — an always-stale newest minute would be a worse trade — but "identical numbers" is accurate only below the boundary, not across the whole page.

**Reads combine the rollup with a raw tail.** The rollup only holds *closed* minutes, so the newest minute — the one that matters while watching an incident — is never in it. A read takes the rollup below `rollup_state.rolled_up_to` and raw `events` above, so a just-ingested event is visible immediately. When `rolled_up_to` is `NULL` (nothing built yet, e.g. straight after the migration) the whole range comes from `events`, which is exactly the behaviour that preceded the table.

**What the tail costs.** Measured 2026-08-20 on a 500k-event local corpus (~115 events/minute), varying only how far the boundary sits behind the newest event:

| tail width | events in the tail | rollup only | rollup + tail | tail |
|---|---|---|---|---|
| 2 min | ~230 | 3.48 ms | 3.60 ms | **0.12 ms** |
| 30 min | ~3,450 | 3.62 ms | 5.72 ms | **2.1 ms** |
| 240 min | ~27,600 | 3.41 ms | 11.13 ms | **7.7 ms** |

Roughly **0.3–0.6 µs per event in the tail** — an index range scan over the newest partition. The cost tracks *how far behind the rollup is*, not the range being charted: a 30-day chart with a two-minute tail costs the same tail as a one-hour chart with one.

In steady state the boundary sits at the start of the current minute, so the tail holds at most one minute of ingest — about 1,000 events at the staging run's rate, well under a millisecond.

It also means **a stalled job degrades speed, never correctness.** Four hours without a rebuild costs 11 ms instead of 3.4; the worst case is a return to the ~91 ms the same query took before the rollup existed.

**Late events.** Ingest accepts timestamps up to 30 days old, and `events` records when an event *happened*, not when it *arrived* — so nothing in that table can reveal a late arrival. The ingest path therefore pulls `rollup_state.refresh_from` back to the batch's oldest timestamp (`LEAST`, so a later batch of fresh events cannot push it forward again). A batch carrying a three-day-old event costs one wider rebuild, then the watermark returns to normal.

**Top errors has its own, capped window.** It is the only widget on the overview whose query can never come from the rollup, so it runs against raw `events` and its cost is proportional to the errors it scans — `EXPLAIN` shows the index finding rows in 0.35 ms while fetching them takes 2,133 heap blocks for 2,785 rows, roughly one random page each, because errors are ~7% of events and scattered among them.

Its range is therefore `min(page range, 24h)` (`clampTopErrorsWindow`), and the widget displays the period it covers. It never shows *more* than the page asked for — a 15-minute page gives 15 minutes of errors — only less. Without the cap, selecting 30 days on the filter bar would have this widget aggregating 30 days of messages, which is the page's worst case and one click away.

There is deliberately **no selector**. It would buy the ability to choose a window, which nobody has requested, at the cost of a second time control on a page that already has one. Add it when a request names the windows it needs.

**What it does not cover:**

- **Anything keyed by message** — top errors, top messages. 168k distinct messages per 500k events cannot be pre-aggregated at a fixed grain, and merging per-minute top-N lists is *approximate*: a message ranked eleventh every minute can be first over the hour and appear in no bucket at all. Since the point of the rollup is that everyone sees the same numbers, making them quietly wrong would defeat it.
- **A level filter combined with an environment filter.** `by_level` and `by_env` are marginals, not a joint distribution; that combination would fall back to `events`. Storing the cross product would make every 30-day read walk a nested object across 43,200 rows per project to serve a rare filter. *Moot on the overview since 2026-08-20 — it has no level filter — but the constraint is a property of the rollup's shape, so it still governs anything built on it.*
- **`release`**, and it never will. A release identifier is *designed* to change on every deploy, so as a rollup dimension it grows without bound — a worse version of the environment-cardinality problem, and less obvious.

**Retention.** `pruneRollup()` drops rollup rows past 30 days on every run; without it the rollup would keep counting events whose partitions retention had already dropped, and the two would disagree silently.

### Environment registry

The filter bar's environment list comes from **`project_environments`**, a per-project registry written on the ingest path (`features/ingest/services/environment-registry.service.ts`), not from a scan of `events`.

- **Written after the events are inserted**, from the distinct environments in the batch — including `null`, which is a value here rather than an absence, because "(unset)" is one of the options the filter offers.
- **A failure never fails the request.** The registry is derived data: losing an update costs a filter entry until the next event from that environment, whereas throwing would lose the event. `ingest.service.ts` catches and logs it, and that is the only deliberately swallowed error on the ingest path.
- **`last_seen_at` is refreshed at most once a minute per row** (`setWhere` on the upsert). Updating it on every request would produce a dead tuple per batch on a table of a few rows, for a column only ever read against a 30-day window.
- **Reading still looks back 30 days** — `last_seen_at >= now() - 30 days` — so a decommissioned environment ages out exactly as it did when the list came from `events`.
- **The list still ignores the selected range**, unchanged from before: it answers "what this organization uses", not "what appeared in the last hour". Narrowing it to the range would make an option vanish the moment you picked a window in which it had no events.

**Why:** `pg_stat_statements` measured the old 30-day scan at **13.4% of the org overview's total database time** on 2026-08-20 — 30 days of events read on every page load to produce a list of a handful of values. Measured after the change: 39.3 ms → 0.67 ms, and the query no longer appears among the page's costs at all. Page wall-clock barely moved (~106 ms → ~92 ms, within run-to-run noise) because the query ran in parallel with slower ones — what dropped is total database work, which is what matters under concurrency. See `PLAN.md` §16.1 Stage D.

**Not covered by the registry:** the environment pills on each *project card*, which are scoped to the selected range — a registry cannot answer "which environments appeared between X and Y" without storing per-range data.

*Superseded later on 2026-08-20.* They were not left on `events`: the **rollup** answers them, from `by_env` per minute unioned with a raw tail, and the query is `ARRAY_AGG(DISTINCT env)` over that union (`overview.service.ts`). The 23.8% figure this paragraph quoted was the cost of the version it describes and no longer measures anything. The product question about what the pills *mean* was never answered — it stopped mattering, because a per-minute `by_env` can be summed over any range.

### ~~Known bug: an environment name containing a comma is split in two~~ — fixed 2026-08-20

`getProjectSummaries` collects a project's environments with `STRING_AGG(DISTINCT environment, ',')` and then splits the result on `","` in TypeScript. The ingest schema validates `environment` only as `z.string().max(128)`, so a comma is a legal value — and `eu,prod` arrives on the project card as two environments, `eu` and `prod`.

Reachable through the public ingest API without anything unusual, and found by the integration suite on the day it was written.

**Fixed 2026-08-20**, as a side effect of moving the environment pills to the rollup rather than as a change of its own: the union now aggregates with `ARRAY_AGG(DISTINCT env)` and nothing splits a string, so a comma in an environment name is carried through intact. The pinned test was inverted rather than deleted — `overview.service.itest.ts` now asserts *"keeps an environment name that contains a comma intact"*.

Worth keeping the paragraph above: the bug is a good example of a query and its consumer disagreeing about a separator, which is the same shape as the cache-key collision `shared/utils/query-cache-key.ts` guards against.

### ~~Known inconsistency: level filter and the per-project top message~~ — closed 2026-08-20

*What follows describes behaviour that no longer exists; it is kept because the closure below only makes sense with it.* `getProjectSummaries` applied the level filter to its statistics query but **not** to its top-message query, which was hardcoded to `level IN ('error','fatal')`. Filtering the overview to `levels=info` therefore showed a project with an error count of 0 and an error message displayed beside it. `getOrgTopErrors`, on the same page and under the same filter, *does* respect the level filter — so the two widgets disagree.

**Closed 2026-08-20 by removing the level filter, not by answering the product question.** The two readings — "top error regardless of filter" and "top message within the filter" — are both gone with the filter that produced them; the overview now narrows by range and environment only. Neither of the two functions involved accepts a `levels` argument any more — `getProjectSummaries` itself was split into `getProjectStats` and `getProjectTopMessages` later the same day — so the disagreement is unreachable rather than merely unfixed.

Why removal rather than a fix: the filter reached three of the overview's eight widgets and left five visibly unchanged, which reads as a broken control rather than one with a documented scope. Full reasoning in `OverviewFilterBar.tsx`; the per-project drill-down it offered still exists on the events page, where filtering applies to everything on screen.

The e2e test that pinned the defect is gone with it. What replaced it asserts the property the removal has to hold: a bookmarked `?levels=info` URL now narrows nothing. The integration tests for the same pair were removed for the same reason.

### The template rollup

Added 2026-08-23. A second rollup, keyed by the **shape** of a message rather
than by its text, so `topMessages` stops scaling with the number of events.

The problem it solves is in [`PLAN.md` §16.3](../PLAN.md): at 8.9M events a
7-day `topMessages` read scanned 4.5M rows and hashed **1,133,715 groups** in
~17 s, and that grew linearly with traffic. Grouping by template instead makes
the cost track the number of *kinds* of message, which does not grow when
traffic does.

**How a template is derived.** `normalizeMessage` (`features/ingest/utils/`)
replaces value-shaped tokens with `***`:

```
User u_487 signed in              → User *** signed in
Payment d6ffe13f done in 2417ms   → Payment *** done in ***
Third-party API returned 503      → Third-party API returned 503
```

Nine ordered rules, all matching *form* rather than meaning: UUIDs, ISO
timestamps, emails, IPs, URLs, numeric path segments, hex blobs of 8+, prefixed
identifiers, digits immediately followed by letters, and bare digit runs of 4+.
Order is load-bearing — a digit rule ahead of the UUID rule eats a UUID
piecemeal and the UUID rule never matches again.

Boundaries are Unicode lookarounds over `\p{L}\p{Nd}` rather than `\b`, which
JavaScript defines over ASCII and which does nothing at all in a script without
spaces. Measured collapse on staging over 24 hours: **674,634 distinct messages
→ 18,080 templates, a factor of 37.3**.

⚠️ **It removes machine variability, not semantic variability.** A name, a
hostname, a role word or free text in quotes has no form distinguishing it from
the words around it, so `User Alice signed in` and `User Bob signed in` remain
two templates. No regular expression fixes that — only the author of the
application knows which word was the variable, which is what makes the
`message`/`attributes` rule in `PLAN.md` §17 the other half of this.

It also **under-collapses deliberately**: short bare numbers survive, so
`returned 503` and `returned 500` stay apart. The same choice keeps `Retry 1 of
3` and `Retry 2 of 3` apart, which is wrong. Telling the two cases apart needs
the sentence read, so the rule takes the side where the mistake is cheaper — two
groups that should be one is noise, one group that should be two hides a
distinction.

**The raw message is never modified.** Ingest stores what was sent and adds
`events.template_hash` beside it. Normalising is a heuristic and will sometimes
be wrong; ingest is a one-way door, so destroying `sess_ai6h2q` because a rule
said so would be irreversible. A bad rule is fixed by bumping
`NORMALIZER_VERSION`, which is folded into the hash input so two generations of
rules can never be summed under one key.

**Coverage is an interval, not a prefix** — the one way this rollup differs from
`event_rollup_minutes`. Events ingested before `template_hash` shipped carry no
fingerprint and never will, so `rollup_state` records both
`templates_rolled_up_from` and `templates_rolled_up_to`. `topMessages` uses the
rollup only when the requested range starts at or after the floor; otherwise it
falls back to grouping raw text. That fallback is load-bearing until 30-day
retention rolls the pre-deploy events out, and deleting it would silently drop
every older message from the list.

**Grain is one minute**, matching `event_rollup_minutes`, and chosen on a
measurement rather than symmetry. Hour grain would be six times smaller (850
rows/hour against 5,344) but leaves a raw tail of up to an hour — ~114,000
events to scan on every read against ~1,900 at minute grain. Short ranges are
the common case and that is where the tail dominates. At 5,344 rows/hour the
table costs ~3.85M rows a month, about 385 MB, against an `events` table heading
for 38 GB.

`message_templates` holds the display text, one row per `(project, hash)`. It is
**not** pruned with the rollup: it is a vocabulary rather than a measurement, and
dropping a template whose last event just aged out would lose the text for a
fingerprint that reappears the next time that shape is logged.

## Alerts

An **alert rule** (`alert_rules`, scoped to one project) consists of:
- **`filter`** — the exact same `EventFilters` shape used by the events list (minus pagination).
- **`condition`** — `{ type: "threshold", count: <positive int>, windowMinutes: 1–1440 }`: fire if at least `count` matching events occur within the trailing `windowMinutes`.
- **`channels`** — array (≥1) of webhook channels: `{ type: "webhook", url, headers?: [{key, value}] }`. Webhook is currently the **only** channel type implemented. `url` is additionally checked by an SSRF guard at save time *and* at every delivery — see [Delivery](#delivery).
- **`notifyOnResolve`** — whether transitioning back to `ok` also sends a notification (default `true`).

### Evaluation (every minute, via the `alert-evaluation` pg-boss job)

For every enabled rule (across all projects, evaluated in parallel batches of 10, one rule's failure doesn't block others):
1. Count matching events in `[now - windowMinutes, now)` using the same filter-building logic as the events list.
2. `newState = matchCount >= condition.count ? "firing" : "ok"`.
3. If unchanged, just bump `last_evaluated_at`/`last_match_count` (guarded by an optimistic-concurrency `version` check so a concurrent rule edit isn't silently overwritten).
4. If the state **transitions**, update `state`/`state_changed_at`/`version`, and — only if the new state is `firing`, or it's `ok` **and** `notifyOnResolve` is true — insert an `alert_notifications` row and enqueue one `alert-delivery` job per webhook channel.

### Delivery

`alert-delivery` job: POSTs the JSON payload to the webhook URL with a 5-second timeout.

Before the request goes out, `assertPublicWebhookTarget()` re-validates the target — scheme, credentials, IP literals, and a fresh DNS resolution checked against private/reserved ranges. This runs on **every** delivery, not just at rule-creation time, because a hostname that resolved publicly when the rule was saved can be repointed inward later. See [security.md](security.md#outbound-request-safety-ssrf) for the full ranges and the `ALLOW_PRIVATE_WEBHOOK_TARGETS` opt-out.

Response classification:

| Outcome | Result | Retried? |
|---|---|---|
| 2xx | delivered | — |
| 3xx | failed — `"Webhook redirected; refusing to follow"` | **No** |
| 4xx | failed | **No** — permanent config error |
| 5xx, network error, timeout | failed | **Yes** — pg-boss `retryLimit: 3, retryDelay: 30s, retryBackoff: true` |
| SSRF guard rejection | failed, no request ever sent | **No** |

The fetch sets **`redirect: "manual"`**, which is why 3xx surfaces as a failure rather than silently resolving: auto-following would re-enter the request with a `Location` the SSRF guard never vetted.

Webhook payload shape (`build-payload.ts`):
```json
{
  "rule_id": "...", "rule_name": "...", "project_id": "...",
  "state": "firing", "previous_state": "ok",
  "triggered_at": "...",
  "condition": { "type": "threshold", "count": 5, "windowMinutes": 10 },
  "filter": { ... },
  "sample_events": [ /* up to 3 */ ],
  "events_url": "https://.../events?levels=error&range=...",
  "test": false
}
```
`condition` mirrors the rule's stored condition exactly, so the shape in the webhook is the shape in the schema. Note that `count` here is the *threshold to fire*, not the number of events that matched — the match count is not part of the payload. Until 2026-08-19 the payload also carried a `threshold` key duplicating `count`; it was undocumented, had no consumer, and was removed while the install was still pre-launch and dropping it broke nothing.

`events_url` is built from the validated **`APP_URL`**. Until 2026-08-13 it read a `NEXT_PUBLIC_APP_URL` that was defined nowhere, so every webhook ever sent carried a `http://localhost:3000/...` link — see [stack.md](stack.md#environment-variables). **Verified against a real deployment on 2026-08-19**: both the firing and the resolve webhook carried a correct absolute URL on the deployed host.
`sample_events` only re-applies the rule's `levels` filter when picking sample rows — not the full filter (environments/sources/attributes/etc. are ignored for sample selection, though they *are* applied when computing the actual match count for the threshold). Test-fire requests (from the "Test" button in the UI) use a hardcoded fake event instead of querying the DB.

### Rule mutation side effects

- Editing a rule's `filter`, `condition`, or `channels` resets `state` back to `"ok"` (avoids a stale "firing" reading against a condition that no longer applies) and bumps `version`.
- Disabling a currently-firing rule also resets its state to `"ok"`, so re-enabling it later doesn't produce a spurious "resolved" notification.

> **Doc drift notes** (`docs/features/06-alerts.md` vs. actual code): the doc describes `alert_notifications.state` as `firing｜resolved`; the code actually uses `firing｜ok` (mirroring `alert_rules.state`). The doc describes an explicit 3-step retry delay array with backoff disabled; the code uses a single 30s base delay with pg-boss's built-in exponential backoff enabled.
