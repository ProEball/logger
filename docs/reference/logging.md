# Logging Model: Events, Filtering, Dashboard, Alerts

This is the product's core domain: what a "log" (called an **event** throughout the code) looks like, how it's typed, how it's queried, and what's built on top of it (dashboard, alerts).

## The `events` table

**Events are in ClickHouse, and only there, since 2026-08-26.** The Postgres
`events` table, its daily partitioning, its pg_partman registration and the dual
write that fed it during Phases 2–3 are all deleted (Phase 4 of
`docs/features/09-clickhouse.md`). See
[architecture.md](architecture.md#the-events-table) for the table itself and
[api.md](api.md#where-an-event-is-written) for what a caller can observe.

The column list below is the **domain** shape — what `Event` carries and what a
component reads — not the storage types. `null` here means "not set"; the
ClickHouse schema has no `Nullable` column anywhere and stores absence as the
empty string, which `core/clickhouse/from-event-row.ts` converts back.

| Field | Domain type | Absent as | Stored as |
|---|---|---|---|
| `id` | string | — | `UUID`, a server-generated **UUIDv7** (was v4 until 2026-08-26; a random id compressed at ratio 1.0 and was a fifth of the table) |
| `projectId` | string | — | `UUID`. **No foreign key** — see [security.md](security.md) |
| `timestamp` | Date | — | `DateTime64(3, 'UTC')`, and the **partition key** (monthly) |
| `level` | string | — | `Enum8` of the five names, validated by Zod at ingest and again by the column |
| `message` | string | — | `String`; a `message_lower` twin is materialised for the token index |
| `source` / `environment` / `release` / `errorType` | string | null | `""` | `LowCardinality(String)` |
| `userId` / `sessionId` / `requestId` / `traceId` | string | null | `""` | `String`, each with a bloom filter |
| `stackTrace` | string | null | `""` | `String` |
| `attributes` | `Record<string, unknown>` | `{}` | `JSON` — one subcolumn per path |
| `context` | `Record<string, unknown>` | `{}` | `String`: displayed, never filtered, so it is an opaque blob |
| `userAgent` | string | null | `""` | `String`, server-filled, never client-supplied |
| `ip` | string | null | `::` | `IPv6`, server-filled from `x-forwarded-for` (first hop). **Validated since 2026-08-26** — an unparseable value is stored as `::`, because the column rejects it by failing the whole insert |
| `templateHash` | bigint | — | `UInt64`. Unsigned end to end since 2026-08-26; while Postgres held the same value in a signed `bigint` it had to be folded on the way in and out |

One field is written and never read back into an `Event`: **`message_template`**,
the output of `normalizeMessage(message)`. It is what the top-messages widgets
label a group with, and it is stored per row rather than looked up in a table
because the normaliser is TypeScript and has no SQL equivalent — see
[widgets.md](widgets.md) and `core/clickhouse/schema.sql`.

**A blank optional string is stored as absent** (2026-08-26). `{"environment": ""}` and a missing `environment` produce the same event, so `""` never appears as a facet value of its own beside `(unset)`. Normalised at the Zod schema.

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

**Since 2026-08-26 every one of these is answered by ClickHouse**, not Postgres
— see [Where an event is read](#where-an-event-is-read) below. The filter is
compiled by `core/clickhouse/filter-compiler.ts`, which both the events list and
the alert evaluator call; neither builds a clause of its own any more.

| Filter | ClickHouse |
|---|---|
| levels, environments, sources, releases, errorTypes | `<column> IN {p:Array(String)}` — an `Enum8` compares against an array of names directly, and a name that is not in the enum simply never matches rather than raising |
| userId, sessionId, requestId, traceId | `<column> = {p:String}`, each backed by a `bloom_filter` skip index |
| message | the grammar below, over `hasToken` / `position` on `message_lower` |
| attributes | `toString(getSubcolumn(attributes, {k:String})) = {v:String}`, one clause per filter, ANDed |

Two of those changed behaviour, deliberately:

- **An attribute filter now compares as text.** Postgres used
  `attributes @> '{"key":"value"}'::jsonb`, which is type-strict — and a URL only
  ever carries strings, so a filter on a **numeric** attribute (`retries=2`)
  matched nothing at all, silently. Comparing `toString` of the stored value
  makes the stored `2` and the typed `"2"` agree.
- **A filter for the empty string means "the key is present and blank."**
  `toString` of a path no row has is also `''`, so that one case additionally
  asserts `dynamicType(...) != 'None'`. Every other value pays nothing for this.

Filter state lives entirely in the URL and never throws on malformed input
(invalid values are silently dropped), so stale/malformed share links still
render something sensible. Attribute **keys** are bound as query parameters like
everything else — an attribute path can be a bound `getSubcolumn` argument, so
no part of a URL is ever spliced into SQL text. See
[security.md](security.md#clickhouse-queries-parameter-binding-is-now-a-rule-not-a-library-guarantee).

- **Facet counts**: for each of levels/environments/sources/releases/errorTypes, the UI shows a per-option count scoped by *every other* active filter (but not that field's own filter, so unchecking a box doesn't zero out its own option list). Text facets cap at the top 20 options; blank values are shown as `"(unset)"` — the ClickHouse schema has no `Nullable` column, so the empty string plays the role `NULL` played in Postgres. Ties are broken by value, so the twenty options that survive the cap are the same on two identical loads; Postgres ordered by count alone and left the rest to the plan.

  **Loaded when the filter panel opens, not with the page** (changed 2026-08-20). These are five aggregations over the whole filtered range, and until then they ran inside the events route's `Promise.all` on every load — including auto-refreshes, and including the great majority of loads where nobody opens the panel, since `FiltersPopover` keeps its open state in client `useState` and the server never learned of it. A normal events page is now a single query: one keyset page of 51 rows.

  They are re-fetched on **every** open rather than cached, because the counts are scoped by the active filters and those change between openings. The fetch goes through `getFacetCountsAction`, which re-checks session and `events.read` — a Server Action is a public endpoint, so the page's own membership check does not cover it. If it fails, the panel still filters; only the numbers are missing, and it says so.

**Pagination** is cursor-based (keyset, not offset): page size 50, `WHERE (timestamp, id) < (cursor_ts, cursor_id) ORDER BY timestamp DESC, id DESC`, fetching 51 rows to detect `hasMore`. Changing any filter resets the cursor. There is no total count shown — only "50" or "50+".

The tuple form is literal in ClickHouse rather than expanded into
`ts < ? OR (ts = ? AND id < ?)`, and `(project_id, timestamp, id)` is the
table's sort key, so the comparison and the `ORDER BY` are the same ordering by
construction. That matters for the tie case: ClickHouse compares `UUID` its own
way, and what keeps a row from being served twice or skipped is that both halves
of the pagination use *that* ordering, not that it matches string order.

A malformed cursor resets to the first page. Until 2026-08-26 the id was
validated as "36 characters of hex and hyphen", which accepts a row of hyphens;
it is now checked as an actual UUID, because the value is bound as a ClickHouse
`UUID` parameter and an unparseable one is a server error rather than a page.

### Message search

Postgres answered `message` with
`to_tsvector('simple', message) @@ websearch_to_tsquery('simple', $q)`.
ClickHouse has no equivalent, so `core/clickhouse/search-query.ts` parses the
same grammar into a predicate tree and the compiler emits it against
`message_lower` (a `MATERIALIZED lowerUTF8(message)` column backed by a
`tokenbf_v1` index).

| Typed | Emitted |
|---|---|
| `timeout` | `hasToken(message_lower, 'timeout')` — uses the index |
| `"connection refused"` | both `hasToken`s, plus `position(message_lower, 'connection refused') > 0` for adjacency |
| `-debug` | `NOT hasToken(message_lower, 'debug')` |
| `a b or c` | `(hasToken(a) AND hasToken(b)) OR hasToken(c)` — `or` binds looser, as in `websearch_to_tsquery` |

Three differences from the Postgres behaviour, all deliberate:

- **A term of two or more tokens also requires the literal text.** `foo_bar`
  matches `foo_bar` and not `foo bar`, where `<->` accepted both. A
  **single**-token term is matched by its token alone, so `timeout.` still finds
  `timeout` — that case is what the rule must not break.
- **A term the tokenizer finds no tokens in** (`+++`, `-->`) becomes a plain
  substring test. Postgres produced an empty tsquery and matched nothing.
- **Tokenization is ClickHouse's, reimplemented in TypeScript.** A token
  character is an ASCII letter or digit, or **any code point at or above
  U+0080** — so `_`, `-` and `.` split, while `café`, `привет` and `a—b` are each
  one token. This is not cosmetic: `hasToken` *raises* `BAD_ARGUMENTS` on an
  empty needle or one containing a separator, which would be a 500 on the events
  page rather than an empty result. The rule is checked against the server's own
  `tokens()` on a battery of inputs in
  `features/events/services/events-query.service.itest.ts`.

Lowercasing is JavaScript's against the column's `lowerUTF8`; they differ on
code points whose lowercase form has a different length (Turkish `İ`), where the
result is a term that matches nothing rather than an error.

### Where an event is read

**Every read is ClickHouse** as of 2026-08-26: the events list, the drawer, the
facet counts, both dashboards' aggregations, the alert evaluator's match count
and the sample events in an alert webhook. Postgres holds no events at all.

The remaining Postgres queries on these paths ask about *projects*, not events —
which is the shape every cross-store question in this application takes.

No read path joins `projects` any more, because ClickHouse cannot. The
defence-in-depth check that join provided — never show events belonging to a
soft-deleted project — is a Postgres primary-key lookup issued **concurrently**
with the ClickHouse query, so it costs no added latency; if the project is gone
the result is discarded and the page is empty. Both callers already resolve the
project through `getProjectBySlug`, which filters `deleted_at IS NULL`; this is
the second line, kept rather than quietly dropped.

## Dashboard

Per-project metrics. Since 2026-08-25 every query comes from `shared/services/event-aggregations.service.ts` — the same functions the organization overview calls, scoped to one project instead of several. `features/dashboard/services/aggregations.service.ts` is deleted.

- **KPI row**: Total events (+ sparkline), Errors (error+fatal count), Fatal (fatal-only count), Firing alerts (count + up to 3 rule names). The per-minute rate left this row on 2026-08-25 and now reports the **last completed minute** rather than an average over the range — at 30 days that average was a month of traffic over 43,200 minutes, a number that moved for reasons nobody could see.
- **Live rate**: not a dashboard widget at all any more. It spent a few days in the filter bar's leading slot and then moved to the **application top bar**, beside the project name, where it is rendered by the project *layout* and so appears on every project page — events, alerts, API keys, settings. Two behaviours follow from that and are intended: it counts the **whole project**, ignoring the environment pills, because a layout cannot read `searchParams`; and it re-reads only when the page itself re-renders, which on pages without an auto-refresh control means once, on arrival. Backed by `eventsInLastMinute` on a **10-second** cache profile — the standard 30-second one would let a "last minute" reading describe a minute that ended ninety seconds ago. Formatting is `shared/utils/live-rate.ts`.
- **Events chart**: stacked area, coloured by level, only rendering levels actually present. Since 2026-08-25 it is `shared/components/EventChart` in `stacked-area` mode — the same component the organization overview draws in `line` mode.
- **Level breakdown**: counts per level, click-through to the events list pre-filtered by that level.
- **Recent errors**: latest error/fatal events.
- **Top sources** / **Top messages**: grouped counts. **Top messages groups by `template_hash` since 2026-08-26** and is labelled with the stored `message_template`, so `User u_487 signed in` and `User u_912 signed in` are one row reading `User *** signed in`. Each group shows `latestAt` and a dominant level (`pickDominantLevel`, ties toward the more severe).

  Until then this widget had **two answers**, chosen by whether a Postgres rollup covered the range and whether an environment filter was active: the rollup path grouped the fingerprint, the fallback grouped `SUBSTRING(message, 1, 200)`. Those are different questions — one says a template occurred 4,000 times, the other says four thousand things occurred once — and nothing on screen said which you were looking at.

### Bucket sizing

Chart resolution comes from `BUCKET_SECONDS` in `shared/utils/dashboard-filters.ts` — see the table under [Organization overview](#bucket-sizing-1), which both pages now share. The route reads the width and passes it to the query; no service computes one.

`pickBucket()` and the whole of `features/dashboard/utils/aggregation-utils.ts` were **deleted** on 2026-08-25. It chose among four widths (1m/1h/12h/1d) by range length, which fit six presets badly — most visibly at 6 hours, where it drew six points.

Bucketing uses epoch-floor arithmetic — `intDiv(toUnixTimestamp(timestamp), secs) * secs * 1000`, giving epoch milliseconds directly. The Postgres form was the same arithmetic (`to_timestamp(floor(extract(epoch from timestamp)/secs)*secs)`) and for the same reason: `date_trunc` takes only unit names and cannot express a 5-minute, 15-minute or 6-hour width.

ClickHouse's own `toStartOfInterval` **is not used**, and the reason was measured rather than assumed: it returns `DateTime`, not `DateTime64`, so `toUnixTimestamp64Milli` rejects its result outright. The two agree on every width the UI asks for — `lab/clickhouse/probe-aggregate-shapes.mjs` checks that — but only one of them can be read back as milliseconds.

> **Doc drift note**: the original design doc (`docs/features/05-dashboard.md`) specifies a 5-tier bucket scheme (`1m/5m/15m/1h/4h`). The shipped implementation used 4 tiers until 2026-08-25 and now uses a table with one width per preset. If you are consulting the feature doc for bucket behaviour, trust `shared/utils/dashboard-filters.ts` instead.

### Zero-fill

The aggregation query only returns buckets that had at least one event (sparse result set). `fillBuckets()` walks every bucket boundary across the full requested range and inserts `{ total: 0 }` entries for any missing bucket, so charts show a continuous line/area that visibly drops to zero during quiet periods instead of just stopping short.

## Organization overview

Cross-project rollup at `/[org]`. Since 2026-08-25 it reads `shared/services/event-aggregations.service.ts`, shared with the project dashboard; `features/overview/services/overview.service.ts` is deleted. Row assembly lives in `features/overview/utils/`, URL parsing in `shared/utils/dashboard-filters.ts`, neither in the route.

- **KPI row**: total events, errors + fatals, firing alerts (plus total enabled rules), project count. The first two carry a sparkline built from the volume buckets summed across projects.
- **Error-ratio chart**: one series per project, plotting `(error + fatal) / total` per bucket. Backed by `eventBuckets` in `shared/services/`, shared with the project dashboard since 2026-08-25, and **narrowed by the environment filter** since the same date — it was the last widget on the page that ignored it.
- **Projects**: cards by default, switchable to a table. **A project with no events in the range still gets a row, showing zeros** — dropping it would make a quiet project look deleted.
- **Top errors across org**: `error`/`fatal` grouped by `SUBSTRING(message, 1, 200)`, top 5, each attributed to a project via `mode() WITHIN GROUP (ORDER BY project_id)` — so a message occurring in several projects is labelled with only one of them.
- **Level breakdown**: counts per level. Rendered in severity order (`fatal → debug`) by the component, not in the order the query returns.

### Bucket sizing

Both pages now read `BUCKET_SECONDS` in `shared/utils/dashboard-filters.ts`, one table with two named densities. `OVERVIEW_BUCKET_SECONDS` and the module holding it were deleted on 2026-08-25.

| Range | `coarse` (overview) | `fine` (project) | points |
|---|---|---|---|
| 15m | 60s | 60s | 15 |
| 1h | 300s | **60s** | 12 / 60 |
| 6h | 900s | 900s | 24 |
| 24h | 3600s | 3600s | 24 |
| 7d | 6h | 6h | 28 |
| 30d | 1d | 1d | 30 |

`1h` is the only cell where the two disagree, and a test asserts it stays that way. The project dashboard's 1-hour view is a live minute-by-minute tail, which is what makes it useful during an incident; the overview draws one series *per project*, so sixty points times five projects is three hundred marks on a sparkline-height chart.

Everything else is now identical, and the previous project-side widths at 6h (3600s, six points) and 7d (12h, fourteen points) are gone — those were not a resolution trade-off but a consequence of `pickBucket()` having only four widths to choose from. *Superseded note: this section previously described the disagreement as "a wart rather than a design" whose unification was deferred to `PLAN.md` §16.1 because it changes what the chart shows. It does change what the chart shows, and that was decided rather than deferred on 2026-08-25 — see §17.*

Both pages read the table. `eventsPerMinute` was the last holdout and was deleted on 2026-08-25 along with `pickBucket()`; the project dashboard's 6h chart went from six points to twenty-four, and its 7d from fourteen to twenty-eight.

### Ordering: count columns are cast to text

> **The trap itself is gone as of 2026-08-26** — it was a Postgres name-resolution
> rule and ClickHouse does not have it. The section stays because it is the
> clearest record of a defect class this repository shipped **three times**, and
> because what replaced it is a weaker guarantee than it looks: the ordering is
> now *correct* by construction, but a tie is still resolved arbitrarily unless
> the query says otherwise. Every `ORDER BY` in
> `event-aggregations.service.ts` therefore carries an explicit tiebreak.

These aggregations returned counts as `COUNT(*)::text` (to avoid `bigint` serialisation), and **`ORDER BY count DESC` would bind to that text alias**, sorting lexicographically — `"9"` ranks above `"10"`. Where the query also has a `LIMIT`, that returns the *wrong rows*, not merely the right rows misordered.

Fixed 2026-08-20 in `getOrgTopErrors` and `getOrgLevelBreakdown` by ordering on `COUNT(*)` instead; covered by `e2e/overview.spec.ts` ("orders top errors by count, not by the text of the count"), whose fixture deliberately uses counts of 10 and 9 because any pair below 10 hides the bug.

**Fixed everywhere 2026-08-21.** The three remaining occurrences were in `features/dashboard/services/aggregations.service.ts`: `levelBreakdown`, `topSources` and `environmentBreakdown`. The first two now order on the aggregate; the third was deleted with its widget, which had been rendered nowhere since before the audit.

What kept them alive for a day was not difficulty — the fix is one identifier — but that nothing could prove it. `PLAN.md` §17 recorded the decision explicitly: fix it only where a test can demonstrate it, because a service with no tests is a service where a "fix" is a guess. `aggregations.service.itest.ts` closed that, and the three tests targeting these defects **failed against the old code before passing against the new** — the fixture project uses counts of 10, 9 and 2, whose text and numeric orderings disagree on the *first* element.

`topSources` was the one that mattered. It applies a `LIMIT`, so the lexicographic sort did not merely mis-order the list: asking for the top 2 of `api` (10), `worker` (9) and `cron` (2) returned `worker` and `cron`, dropping the busiest source entirely.

One trap survived that fix and is now moot with the union it belonged to: `levelBreakdown` re-aggregated a rollup and a raw tail, so the count it needed was `SUM(n)` over the union rather than `COUNT(*)` of union rows — three different queries, only one right. There is no union.

**A different one replaced it, found the same way (2026-08-26).** ClickHouse resolves a select-list alias inside `WHERE`, so `SELECT toString(project_id) AS project_id … WHERE project_id IN {p:Array(UUID)}` compares a `String` against an array of `UUID` — and matches **no rows without raising**. Every bucket and every per-project count returned empty. The SQL is valid, the answer is merely wrong, and only the integration suite could see it. The rule is now stated in `event-aggregations.service.ts`: never alias a converted column back to its own name — and none of those conversions was needed, since `JSONEachRow` renders a `UUID`, an `Enum8` and an `IPv6` as strings already.

### ~~The rollup~~ — deleted 2026-08-26

**`event_rollup_minutes`, `rollup_state`, the `event-rollup` job and the
coverage machinery around them are gone**, with the Postgres `events` table they
summarised (Phase 4 of `docs/features/09-clickhouse.md`). Every dashboard number
is now one query over the raw table; `09-clickhouse.md` §1.2 is the accounting
of what that removed and §6 is what replaces it in Phase 5.

Three findings from that design are worth carrying forward, because the same
questions arrive again with the projection:

- **A scheduled rebuild beats incremental counters.** Counters drift — a lost
  update, a rollback, a race — and the number is quietly wrong with nothing to
  detect it. A rebuild reconstructs each bucket from the source, so error cannot
  accumulate. A ClickHouse projection is maintained by the engine and inherits
  this property for free, which is most of why §1.2 counts the machinery as
  cost rather than as work.
- **A summary that holds only *closed* minutes needs a raw tail**, and the tail
  cost 0.3–0.6 µs per event in it — tracking how far behind the job was, not the
  range being charted. A projection has no watermark, so the newest event is
  visible without a union and without a branch.
- **Everyone seeing the same number was the point, not the speed.** Before the
  rollup, two people opening the same dashboard seconds apart each aggregated
  over their own `now()`. That property is now the read cache's
  (`shared/services/event-aggregations-cache.service.ts`, 30 s), not the
  storage's.

**Retention went with it, and has no replacement yet.** `pruneRollup()` dropped
rollup rows past 30 days, and pg_partman dropped event partitions on the same
schedule. The ClickHouse table carries a `retention_days` column with a default
and **no TTL clause** — that is Phase 6. Until then nothing expires.
### ~~Environment registry~~ — deleted 2026-08-26

The filter bar's environment list came from `project_environments`, a
per-project registry written on the ingest path, because the implementation
before it scanned 30 days of `events` on every page load and
`pg_stat_statements` put that at **13.4% of the page's total database time**.

Phase 4 went **back to the scan**: `SELECT DISTINCT if(environment = '',
'(unset)', environment)` over the same 30-day window. The argument is that
`environment` is `LowCardinality`, so the scan reads one dictionary-encoded
column, and that Phase 5's `p_minute` projection carries `environment` in its
key — at which point the optimizer answers it from the aggregate. Keeping a
Postgres table maintained by ingest to avoid a ClickHouse `GROUP BY` would be
exactly the machinery §1.2 counts as the cost of the old design.

**That argument is not yet measured.** `event-aggregations.service.bench.ts` has
a benchmark named for it, and it is the first number Phase 5 should look at. If
the scan is expensive the answer is the projection, not the registry.

Two behaviours are deliberately unchanged. The list **ignores the range selected
in the filter bar** — it is "what this organization uses", not "what appeared in
the last hour", and narrowing it to the range would make an option vanish the
moment you selected a window in which it had no events. And an event with no
environment is offered as `(unset)` rather than omitted.

**One visible change**: `(unset)` now sorts **first** rather than last.
Postgres ordered by its collation, which weights punctuation below letters, so
the value sorted as if it were "unset"; ClickHouse orders bytewise and `(` is
0x28. Byte order is what this list always wanted — the sibling environment list
in `projectStats` sorted in TypeScript precisely to escape the collation — so
the two are consistent for the first time, and the placeholder sits at the top
of the dropdown.
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

### ~~The template rollup~~ — deleted 2026-08-26

`event_template_rollup` and `message_templates` are gone. What they existed for
survives: **the top-messages widgets group by the shape of a message rather than
its text**, so `User u_487 signed in` and `User u_912 signed in` are one row.

What changed is where the two halves of that grouping live.

- The **key** was always on the event (`template_hash`, a `UInt64` FNV-1a over
  `normalizeMessage(message)` with `NORMALIZER_VERSION` folded into the input,
  so two generations of the rules can never be summed). It still is.
- The **display text** was in `message_templates`, a per-project vocabulary
  written at ingest and joined at read time. It is now a column on the event
  row, `message_template`, written by the same pass of the normaliser that
  computes the hash.

The reason for moving it is that a template cannot be derived in SQL: the
normaliser is a TypeScript shape matcher (see `normalize-message.ts` for what it
can and cannot collapse), so a template that is not on the row is a group no
query can name. The alternative — grouping by `template_hash` and displaying
`any(message)` — would label a group of ten thousand with one arbitrary
instance. The cost is a third near-copy of the message text in a column with
very low cardinality, which is the case ZSTD is best at; see
`core/clickhouse/schema.sql` for the sizing argument and `09-clickhouse.md`
§12.4 for what it measured.

**Coverage is gone as a concept.** The Postgres rollup could not answer for
events ingested before `template_hash` shipped, so every read compared the
requested range against a coverage interval and chose one of two
implementations. There is one implementation. A row written before
`message_template` existed reads back as `''` and is labelled with its raw
message instead — a display fallback, not a second query path.
## Alerts

An **alert rule** (`alert_rules`, scoped to one project) consists of:
- **`filter`** — the exact same `EventFilters` shape used by the events list (minus pagination).
- **`condition`** — `{ type: "threshold", count: <positive int>, windowMinutes: 1–1440 }`: fire if at least `count` matching events occur within the trailing `windowMinutes`.
- **`channels`** — array (≥1) of webhook channels: `{ type: "webhook", url, headers?: [{key, value}] }`. Webhook is currently the **only** channel type implemented. `url` is additionally checked by an SSRF guard at save time *and* at every delivery — see [Delivery](#delivery).
- **`notifyOnResolve`** — whether transitioning back to `ok` also sends a notification (default `true`).

### Evaluation (every minute, via the `alert-evaluation` pg-boss job)

For every enabled rule (across all projects, evaluated in parallel batches of 10, one rule's failure doesn't block others):
1. Count matching events in `[now - windowMinutes, now)` **in ClickHouse**, through `compileFilters` — literally the same function the events list calls, not "the same logic" written twice. Until 2026-08-26 it was a second copy of the events page's clause builder, with nothing comparing the two. The window is half-open (`timestamp < now`) where the events list's is closed; that difference is a parameter of the compiler rather than an accident of two implementations.
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
`sample_events` applies the **whole** filter as of 2026-08-26, through the same `compileFilters` the match count uses — so the three events in the body are drawn from exactly the rows that were counted.

Until then it re-applied only the rule's `levels`, and ignored environments, sources, attributes and message search: a rule filtering on `source` counted one set of events and illustrated itself with another. The mismatch came from this read staying on Postgres when Phase 3 moved the evaluator's count to ClickHouse; Phase 4 moved it and closed the gap in the same change.

The two calls take their `now` a few milliseconds apart, so a sample can in principle be one event newer than the count saw. Test-fire requests (from the "Test" button in the UI) use a hardcoded fake event instead of querying anything.

### Rule mutation side effects

- Editing a rule's `filter`, `condition`, or `channels` resets `state` back to `"ok"` (avoids a stale "firing" reading against a condition that no longer applies) and bumps `version`.
- Disabling a currently-firing rule also resets its state to `"ok"`, so re-enabling it later doesn't produce a spurious "resolved" notification.

> **Doc drift notes** (`docs/features/06-alerts.md` vs. actual code): the doc describes `alert_notifications.state` as `firing｜resolved`; the code actually uses `firing｜ok` (mirroring `alert_rules.state`). The doc describes an explicit 3-step retry delay array with backoff disabled; the code uses a single 30s base delay with pg-boss's built-in exponential backoff enabled.
