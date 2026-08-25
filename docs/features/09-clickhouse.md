# 09 — ClickHouse: events leave Postgres

**Status**: planned, not started. Written 2026-08-26. **Phase 0 run 2026-08-26 — see §14**, which corrects §1.1, §3.2, §6.1, §6.2 and §7. Settled: `ORDER BY`. Chosen with a named ceiling: the `JSON` type (§14.3, §14.3.2). Refuted: two claims about projections.
**Prerequisite**: none — the staging host was destroyed, so there is no data to migrate.

> This is a **planning doc** (`WORKFLOW.md` §1: intent belongs here, not in
> `docs/reference/`). Nothing described here is implemented. When a phase ships,
> its behaviour moves into `docs/reference/` and this file records only what was
> decided and why.

---

## 1. Why, stated honestly

`PLAN.md` §17 (2026-08-24) named three falsifiable triggers for this decision.
**The performance trigger did not fire, and not narrowly**: a cold 30-day
dashboard is 437 ms, its slowest query 181 ms, and 24h/7d/30d land within 45 ms
of each other. So this migration is **not** justified by speed, and any summary
that implies otherwise is wrong.

What justifies it is three things the Postgres implementation cannot absorb.

### 1.1 Retention is becoming unbounded, and Postgres cannot hold it

Target volume is **~10M events/day**, retention **unknown and possibly a year**.

| retention | rows | Postgres (heap + indexes) | ClickHouse (est.) |
|---|---|---|---|
| 30 days | 300M | ~150 GB | ~18 GB |
| 90 days | 900M | ~450 GB | ~54 GB |
| 365 days | 3.65B | **~1.8 TB** | ~150–220 GB |

The host has 240 GB. A year does not fit in Postgres at any setting. That is the
hard constraint, and the only one in this document that is not a matter of taste.

> **Measured 2026-08-26 — the ClickHouse column above is wrong.** 83.5
> bytes/row against the ~40–60 assumed here, so a year is **~0.30 TB** and does
> not fit the 240 GB disk either. The Postgres conclusion is unaffected and the
> gap is still ~6×. See §14.2, including where the bytes actually go — it is not
> the log text.

### 1.2 ~1,450 lines exist solely to work around row storage

`event-rollup.service.ts` (358), `rollup-boundary.service.ts` (241),
`backfill-template-hash.ts` (170), the `event_template_rollup` /
`message_templates` / `event_rollup_minutes` / `rollup_state` schemas (324),
`plan-backfill.ts` (62), the environment registry (83), the partman job (44) —
plus the branches inside `event-aggregations.service.ts` (1,449) that pick
between a rollup path and a raw-events path per query.

Nearly every one has produced a silently wrong answer at least once: three
text-alias `ORDER BY` defects, a coverage guard that disabled the rollup for a
whole organization because one project had no events, a template rollup that
would have missed every pre-deploy event, and a test suite that passed against
all of it.

ClickHouse maintains the equivalents in the database. See §6.

### 1.3 The product is about to ask questions Postgres cannot answer at all

Requirements added 2026-08-26, which reshape the schema more than volume does:

| # | Requirement | Consequence |
|---|---|---|
| R1 | Filters on **almost every field**, on both dashboards, not just range + environment | The fixed-key rollup model collapses — see §6.2 |
| R2 | **Message and attribute shapes differ per project** | Attributes cannot be a fixed column set; the type registry becomes a per-project catalogue |
| R3 | **Custom widgets grouping by almost any property** | Arbitrary `GROUP BY` cannot be pre-aggregated. The raw scan must be fast |
| R4 | **Timelines** (trace / session / user / request) | A second ordering of the same data — see §7 |
| R5 | **AI-assisted search** | Two different features with two different costs — see §8 |

R3 is the one that ends the argument. You cannot build a rollup for a group-by
you do not know in advance. Either the raw table answers it, or the feature does
not exist.

---

## 2. Scope

**Moves to ClickHouse**: `events`, and everything derived from it —
`event_rollup_minutes`, `rollup_state`, `event_template_rollup`,
`project_environments`. All are deleted, not ported.

**Stays in Postgres**: users, sessions, accounts, organizations, roles,
organization_members, invitations, projects, api_keys, alert_rules,
alert_notifications, `pgboss.*`, `attribute_key_types`, `message_templates`.

`message_templates` stays in Postgres deliberately: a small vocabulary (~18k rows
per project, never pruned), read for at most 10 rows per widget render, and §8
gives it a second job that makes it more valuable rather than less.

`attribute_key_types` stays and gets **promoted**. Today it only rejects
type-inconsistent values at ingest. Under R2/R3 it becomes the per-project
catalogue of groupable properties — the thing a custom-widget builder shows in
its "group by" picker. It is the only place that knows project A has `order_id`
and project B has `tenant_tier`.

**The objection this raises, and the answer.** `PLAN.md` §17 (2026-08-20)
rejected "metadata to MongoDB" precisely for adding a second datastore,
cross-store joins in application code, and no transaction boundary. All three
apply here too. The difference is *which* table is split out: `events` is
append-only, never participates in a transaction with anything, and is already
queried by a `project_id` the authorization path resolved beforehand. Metadata
was the wrong thing to split because it joins; events are the right thing
because they do not.

---

## 3. The two irreversible decisions

Everything else in ClickHouse is cheap to change. `ALTER TABLE ADD COLUMN` is a
metadata operation. Skip indexes, projections, TTL and codecs can all be added,
dropped or rewritten on a live table.

**`ORDER BY` and `PARTITION BY` cannot.** Changing either means a new table and a
full re-insert. The official best-practice rule marks this CRITICAL and requires
the query patterns to be written down *before* the table exists. So they are.

### 3.1 Query patterns

| # | Shape | Frequency | Source |
|---|---|---|---|
| Q1 | `project_id = ? AND timestamp BETWEEN ? AND ?` + 0–8 filters, `ORDER BY timestamp DESC, id DESC LIMIT 51` | dominant | `listEvents` |
| Q2 | `project_id IN (…) AND timestamp BETWEEN ?`, `GROUP BY bucket, level, environment` | every dashboard load | `eventBuckets`, `levelBreakdown`, `projectStats` |
| Q3 | same scope, `GROUP BY <one column>`, top-N | facets, `topSources`, `topMessages` | `getFacetCounts` |
| Q4 | same scope, `GROUP BY <arbitrary property>` | **new (R3)** | custom widgets |
| Q5 | `project_id = ? AND trace_id = ? ORDER BY timestamp` — **time bounds unknown** | **new (R4)** | timelines |
| Q6 | `project_id = ? AND timestamp >= now() - N`, `count()` with arbitrary filter | 1×/minute×rule | `alert-evaluator` |
| Q7 | `project_id = ? AND id = ? AND timestamp = ?` | drawer open | `getEventById` |

`project_id` appears in **100%** of them and has low cardinality (tens). A time
range appears in all but Q5.

### 3.2 Decision

```
PARTITION BY toYYYYMM(timestamp)
PRIMARY KEY (project_id, timestamp)
ORDER BY    (project_id, timestamp, id)
```

**Monthly, not daily partitions.** Daily partitioning of a log table is named
explicitly as an anti-pattern in the ClickHouse best-practice rules — 365
partitions per year, unbounded over time, part explosion. Monthly gives 12 per
year. Retention is handled by TTL (§9), not `DROP PARTITION`, because
per-organisation retention makes partitions non-homogeneous anyway.

**`PRIMARY KEY` shorter than `ORDER BY`.** The sparse index is held in memory; a
random UUID contributes nothing to granule pruning and would only inflate it.
`id` stays in `ORDER BY` solely to make Q1's keyset pagination deterministic.

**`level` is deliberately not in the key.** The tempting alternative is
`(project_id, toStartOfHour(timestamp), level, timestamp, id)`, which prunes
level-filtered lists. Rejected because Q1 — the dominant pattern — returns 51
rows in time order, and interleaving five level groups defeats
`optimize_read_in_order`. `level` is an `Enum8`; reading one byte per row across
a project-scoped range costs milliseconds.

**This is the single decision Phase 0 must settle with `EXPLAIN indexes = 1`
rather than argument** — see §13.

> **Settled 2026-08-26 (§14.1).** Candidate A wins every Q1 variant, including
> the level-filtered one B existed to serve — 23× fewer rows there, 27× on the
> unfiltered list. The paragraph above gives the right answer for an incomplete
> reason: the fatal problem is not that interleaving levels "defeats
> `optimize_read_in_order`" as a matter of degree, it is that a `LIMIT` over a
> `DESC` sort cannot terminate early at all when the sort key does not lead on
> time, so the whole range is read and sorted regardless of what `level` prunes.

**Q5 does not fit this key at all.** A timeline lookup has no time bound, so it
prunes to nothing. That is why §7 exists: it needs a second ordering of the data,
not a skip index.

---

## 4. Table: `events`

```sql
CREATE TABLE events
(
    project_id      UUID,
    timestamp       DateTime64(3, 'UTC') CODEC(Delta, ZSTD(1)),
    id              UUID,                                    -- UUIDv7, see 4.2

    level           Enum8('debug'=1,'info'=2,'warn'=3,'error'=4,'fatal'=5),
    message         String               CODEC(ZSTD(3)),
    message_lower   String MATERIALIZED lowerUTF8(message) CODEC(ZSTD(3)),

    source          LowCardinality(String),
    environment     LowCardinality(String),
    release         LowCardinality(String),
    error_type      LowCardinality(String),

    user_id         String CODEC(ZSTD(1)),
    session_id      String CODEC(ZSTD(1)),
    request_id      String CODEC(ZSTD(1)),
    trace_id        String CODEC(ZSTD(1)),

    template_hash   UInt64,

    attributes      JSON(max_dynamic_paths = 2048),          -- see 4.3
    context         String CODEC(ZSTD(3)) TTL timestamp + INTERVAL 30 DAY,
    stack_trace     String CODEC(ZSTD(3)) TTL timestamp + INTERVAL 30 DAY,

    user_agent      String CODEC(ZSTD(3)),
    ip              IPv6,

    retention_days  UInt16 DEFAULT 30,

    INDEX idx_msg     message_lower TYPE tokenbf_v1(32768, 3, 0) GRANULARITY 4,
    INDEX idx_trace   trace_id      TYPE bloom_filter(0.01)      GRANULARITY 4,
    INDEX idx_request request_id    TYPE bloom_filter(0.01)      GRANULARITY 4,
    INDEX idx_session session_id    TYPE bloom_filter(0.01)      GRANULARITY 4,
    INDEX idx_user    user_id       TYPE bloom_filter(0.01)      GRANULARITY 4,
    INDEX idx_errtype error_type    TYPE bloom_filter(0.01)      GRANULARITY 4,
    INDEX idx_tmpl    template_hash TYPE bloom_filter(0.01)      GRANULARITY 4
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(timestamp)
PRIMARY KEY (project_id, timestamp)
ORDER BY    (project_id, timestamp, id)
TTL timestamp + toIntervalDay(retention_days) DELETE;
```

### 4.1 Type choices and why

| Column | Postgres | ClickHouse | Reason |
|---|---|---|---|
| `level` | `text` | `Enum8` | Closed set of 5, already enforced by Zod. 1 byte, validated at insert, **and ordered** — `WHERE level >= 'error'` works natively instead of `IN ('error','fatal')` |
| `ip` | `text` | `IPv6` | 16 fixed bytes vs a 7–39 byte string; v4 stored v4-mapped; subnet functions become available |
| `source` / `environment` / `release` / `error_type` | `text` | `LowCardinality(String)` | All client-supplied but heavily repeated. `release` is the one to watch — ~365 distinct values per project per year, still far under the 10k threshold |
| `user_agent` | `text` | `String` + ZSTD(3) | **Not** `LowCardinality`: cardinality is unknown and browser traffic would blow past 10k, where LowCardinality degrades. ZSTD captures the repetition anyway. Revisit with `uniq(user_agent)` |
| `timestamp` | `timestamptz` | `DateTime64(3)` + `Delta,ZSTD` | Milliseconds are user-visible in a log viewer. Delta coding makes a near-monotonic column compress to ~1–2 bytes/row |
| `context` | `jsonb` | `String` | Displayed, never filtered. The best-practice rule for "JSON as opaque blob, no field queries" is explicitly String |
| `attributes` | `jsonb` | `JSON` | See 4.3 — this reverses an earlier decision |

**No `Nullable` anywhere.** Nullable maintains a separate UInt8 mask per column
and blocks optimizations. Empty string means absent.

> **This requires an ingest change.** `event-schema.ts` gives the optional string
> fields `.max(N)` but no `.min(1)`, so a client can send `environment: ""` and
> Postgres stores `''` — distinct from `NULL`, and it appears as its own facet
> value beside `(unset)`. Add `.min(1)` (or a transform to `undefined`) so `''`
> and absent collapse to one thing. A real behaviour change; belongs in `api.md`.

### 4.2 `id`: switch to UUIDv7

`randomUUID()` produces v4 — 16 fully random bytes that do not compress. At 3.65B
rows that is 58 GB of incompressible column.

UUIDv7 places a millisecond timestamp in the leading 48 bits. Sorted within a
granule by `(project_id, timestamp, id)`, those bytes are nearly constant and
ZSTD takes roughly a third of the column. Node 22's `crypto.randomUUID` is v4
only; v7 is ~15 lines or a small dependency.

Free, and it improves insert locality. No downside identified.

### 4.3 `attributes`: the `JSON` type — reversing an earlier call

An earlier draft proposed three `Map` columns (`attr_str`, `attr_num`,
`attr_bool`), mirroring `attribute_key_types`. **R2 and R3 overturn that.**

A `Map(String, String)` is stored as two parallel arrays. Reading `attrs['foo']`
requires reading *every* key and *every* value for every row in the granule. For
a filter that is tolerable. For `GROUP BY attrs['foo']` over millions of rows —
exactly what a custom widget does — it is the worst case: you pay for all
attributes to read one.

The `JSON` type splits each path into its own **subcolumn**. `attributes.foo`
reads one column and nothing else. That is true columnar access for an arbitrary
property, which is the only way R3 works.

> **Confirmed 2026-08-26 (§14.3), on the second attempt.** The first run
> measured only a 15% edge — against a corpus giving each project three
> attribute keys, where a `Map` has nothing to skip past. Re-run at 18 keys:
> **16× less read and 12× faster**, and JSON's cost did not move when the
> attribute count grew six-fold while the Map's tripled. Storage is a wash.
> **The three-Map fallback is dropped as the plan of record**, but not as an
> option: §14.3.2 found the JSON type carries a per-path memory cost that scales
> with the number of *tenants*, where a Map carries none. The trade is read cost
> against tenant scaling, not a free win. Two costs stand against it — the write
> path (§14.3.1) and that ceiling (§14.3.2).

The best-practice rule for choosing JSON lists three conditions — structure
varies unpredictably, types change over time, field-level querying needed. Under
R2 (per-project attribute shapes) and R3 (group by any property), all three hold.

**The risk, named** — and **measured on 2026-08-26 to bite ten times earlier than
this paragraph assumes**, see §14.3.2. Distinct paths across *all* projects share
one column's path budget. `max_dynamic_paths` (default 1024) is the ceiling before
paths spill into a slower shared structure, but memory per path is the real limit
and it starts failing operations at 180. Ten projects × 20 keys is fine; a hundred projects ×
50 keys is not. Set it explicitly at 2048, monitor the distinct path count, and
treat "paths approaching the ceiling" as an operational alarm. **Phase 0 must
verify the JSON type on the exact ClickHouse version chosen** — it is the newest
construct in this schema and the only one needing a fallback plan (that fallback
being the three-Map design, which costs R3).

`attribute_key_types` keeps enforcing one type per (project, key) at ingest. It
now does two jobs: giving the user a clear error instead of a silently widened
`Dynamic` type, and populating the widget builder's property picker.

> **Measured 2026-08-26, and it promotes the registry from useful to
> load-bearing.** A JSON path reads back as `Dynamic`, and ClickHouse 25.3
> refuses `Dynamic` in a `GROUP BY` key outright:
>
> ```
> Code: 44. Data types Variant/Dynamic are not allowed in GROUP BY keys,
> because it can lead to unexpected results. Consider using a subcolumn with
> a specific data type instead (for example 'json.some.path.:Int64') …
> ```
>
> So `GROUP BY attributes.order_id` — R3's whole premise — **does not run**.
> The working forms are the typed subcolumn `attributes.order_id.:String` or an
> explicit `toString(...)` cast. Both need the query to know the attribute's
> type before it is written, and `attribute_key_types` is the only thing that
> knows it. Without the registry a custom widget can only guess or probe.
>
> There is a `allow_suspicious_types_in_group_by = 1` escape. It is named
> "suspicious" by the people who wrote it, and taking it would mean grouping on
> a column whose type varies per row — exactly the silent-wrong-answer shape
> this migration exists to remove. Do not.
>
> Which of the two forms to emit is `Q4-json` vs `Q4-dyn` in the lab. Note when
> reading those: all three Q4 variants touch the same granules, so `read_rows`
> is identical by construction and only `read_bytes` distinguishes them.

**Open**: attribute values may be `null` today (`inferAttributeType` returns
`null` and the key is skipped). Decide whether a null-valued attribute is stored
or dropped at ingest. Recommendation: drop it — it carries no information and
creating a JSON path for it wastes a path slot. Document in `api.md`.

### 4.4 Skip indexes, and why these

Q1 narrows to one project and one time range through the primary key. Everything
after that is a column read plus, where useful, granule skipping.

The bloom filters on `trace_id` / `session_id` / `request_id` / `user_id` are the
textbook case: high cardinality, exact equality, rare values scattered thinly.
**Postgres has no index on any of these today** — `WHERE trace_id = 'x'` over 30
days is a full range scan. A straight improvement, and what makes R4 viable at
all outside the dedicated table in §7.

No index on `level`, `source`, `environment` or `release`. They are
`LowCardinality`/`Enum8` and appear in *every* granule, so a `set` index would
skip nothing — the rule warns explicitly against indexing values scattered across
all blocks. Reading them is already cheap.

`tokenbf_v1` on `message_lower` backs full-text search — see §5.

---

## 5. Full-text search

`to_tsvector('simple', message) @@ websearch_to_tsquery('simple', $q)` has no
direct equivalent. `simple` does **no stemming and no stopwords** — only
lowercasing and splitting on non-word characters — which is close enough to
`tokenbf_v1`'s tokenizer that parity is achievable.

A ~120-line TypeScript parser turns the `websearch` grammar into a predicate
tree:

| websearch | ClickHouse |
|---|---|
| `timeout` | `hasToken(message_lower, 'timeout')` — uses the index |
| `"connection refused"` | `hasToken(m,'connection') AND hasToken(m,'refused') AND position(m,'connection refused') > 0` |
| `-debug` | `NOT hasToken(m, 'debug')` |
| `a or b` | `hasToken(m,'a') OR hasToken(m,'b')` |

Phrase search: the two `hasToken` calls narrow by index, `position` verifies
adjacency exactly. Negation is correct but cannot skip granules — a bloom filter
proves absence, not presence, so `NOT` inverts it into "cannot skip". In practice
a negation always accompanies a positive term, which does the skipping.

**Rejected: the experimental full-text / inverted index.** It has been rewritten
more than once, and the official best-practice rule set does not mention it at
all. Not a foundation for a shipped feature. Revisit later.

**Rejected: `ngrambf_v1`.** It buys substring-within-token matching, which
`tsvector` never offered either. Bigger index, no parity gain.

The parser is a **pure function** — query string in, predicate tree out — so it
is fully unit-testable, which matters given §11.

---

## 6. Aggregations

### 6.1 The read path becomes one query, not two

`topMessages` today has **two implementations chosen by a coverage check**, and
so does `topSources`. That pattern exists because a Postgres rollup table is a
*different table* from `events`, so the application must decide which to read.

A ClickHouse **projection lives inside the table**. The optimizer picks it
automatically when a query matches (`optimize_use_projections`, on by default).
The application writes one query against `events`. No watermark, no coverage
interval, no raw tail, no union, no branch.

That is the mechanism behind §1.2, and it is worth more than the speed.

> **Half right, measured 2026-08-26 (§14.5).** The optimizer does pick the
> projection with no branch in the application — but only when the `WHERE`
> clause is expressed over columns the projection holds. A dashboard query
> filtering on raw `timestamp` skipped it silently and read 36× more rows for
> the same answer. One query, yes; any query, no.

### 6.2 Which aggregates to build — and why R1 changes the rule

`widgets.md` derived a rule for the Postgres rollup: a dimension enters the key
if a filter uses it; row count is `minutes × projects × cardinality`, so every
dimension is a multiplier and `release` is banned outright.

**The arithmetic is identical in ClickHouse. The threshold is not.** Adding
`source` to the key takes the daily aggregate from ~216k rows to ~2.16M — a
number Postgres would struggle with and ClickHouse does not notice.

> **Refuted 2026-08-26 (§14.6).** Measured at realistic density, `source` in the
> key drops the projection from **25.5× to 7×** compression. The absolute size
> is indeed negligible; the *ratio* is the entire product, and this paragraph
> confuses the two. `widgets.md`'s rule — a dimension enters the key only if a
> filter needs it — survives the engine change. What ClickHouse removes is the
> correctness machinery around a rollup, not the discipline about its key.

But R1 (filters on almost every field) and R3 (group by anything) mean an
aggregate can never cover every case. So the design is two-tier, and the tiers
are explicit:

| Tier | Serves | Backed by | Cost |
|---|---|---|---|
| **1** | The known dashboard widgets — volume, level breakdown, per-project stats | `p_minute` projection | tens of ms at any range |
| **2** | Everything else — R1's wider filters, R3's arbitrary group-by, ad-hoc | raw scan | proportional to range × volume |

```sql
ALTER TABLE events ADD PROJECTION p_minute (
    SELECT project_id, toStartOfMinute(timestamp) AS minute,
           level, environment, source,
           count()
    GROUP BY project_id, minute, level, environment, source
);
```

`source` is included because R1 promotes it to a dashboard filter. `release` is
excluded for the reason `widgets.md` already established — it changes on every
deploy by design — and because tier 2 handles it.

**Tier 2 must be genuinely fast, not a fallback nobody measured.** This is the
critical difference from the Postgres design: there, falling off the rollup meant
17 seconds, which is why so much machinery existed to avoid it. Here a
project-scoped 30-day `GROUP BY attributes.foo` reads one subcolumn over ~3M rows
— tens of milliseconds. Falling back is *normal*, not exceptional, so the
five-line branch that used to be a correctness system disappears.

The one shape that stays expensive is **org-wide × long range × arbitrary
group-by**: 300M rows at 30 days, 3.65B at a year. Custom widgets should be
project-scoped by default; org-scoped ones need either a shorter maximum range or
an accepted multi-second cost. **A product decision, not a technical one, and it
should be made before the widget builder is designed.**

### 6.3 The template aggregate is an MV, not a projection

A projection lives and dies with the rows it summarises. Under §9 the raw events
may expire at 30–90 days while the aggregates must survive a year. Only a
separate table can express that.

```sql
CREATE TABLE events_by_template (
    project_id    UUID,
    hour          DateTime,
    template_hash UInt64,
    n             UInt64,
    n_error       UInt64,
    n_fatal       UInt64,
    latest_at     SimpleAggregateFunction(max, DateTime64(3))
) ENGINE = SummingMergeTree
PARTITION BY toYYYYMM(hour)
ORDER BY (project_id, hour, template_hash)
TTL hour + INTERVAL 1 YEAR;

CREATE MATERIALIZED VIEW events_by_template_mv TO events_by_template AS
SELECT project_id, toStartOfHour(timestamp) AS hour, template_hash,
       count()                  AS n,
       countIf(level = 'error') AS n_error,
       countIf(level = 'fatal') AS n_fatal,
       max(timestamp)           AS latest_at
FROM events
GROUP BY project_id, hour, template_hash;
```

**Known property of MVs, stated so nobody rediscovers it**: an MV is an insert
trigger. It does not observe TTL expiry or `DELETE`. For `events_by_template`
that is the desired behaviour — it must outlive the raw rows — but it means
deleting a project has to clear both tables explicitly.

Sizing depends on **distinct templates per hour**, not per day. The measured
figure is 18,080 templates/day across the whole install; per hour it is likely
3–5k. Phase 0 measures it (§13).

---

## 7. Timelines (R4)

Q5 — "every event for this trace" — has **no time bound**, so it prunes to
nothing under `ORDER BY (project_id, timestamp, id)`. The bloom filter helps but
still touches every partition in retention.

The ClickHouse idiom is a second ordering of the same data:

```sql
CREATE TABLE events_by_correlation (
    project_id UUID,
    kind       Enum8('trace'=1,'session'=2,'request'=3,'user'=4),
    value      String,
    timestamp  DateTime64(3, 'UTC'),
    id         UUID,
    level      Enum8('debug'=1,'info'=2,'warn'=3,'error'=4,'fatal'=5),
    message    String CODEC(ZSTD(3))
) ENGINE = MergeTree
PARTITION BY toYYYYMM(timestamp)
ORDER BY (project_id, kind, value, timestamp, id)
TTL timestamp + INTERVAL 30 DAY;
```

Fed by one MV that fans each event out into up to four rows, one per non-empty
correlation id. Row multiplication is up to 4×, but the table is **six slim
columns** rather than twenty, so its storage is a small fraction of `events`.

It carries enough to render a timeline directly. Opening one entry fetches the
full event from `events` by `(project_id, timestamp, id)` — Q7, a point lookup on
the primary key.

**Rejected: relying on the bloom filter alone.** It reduces granules read but
cannot avoid opening every part in the retention window. At a year that is 12
partitions and hundreds of gigabytes of index touching. A timeline is an
interactive feature; it needs a key, not a filter.

> **Not what was measured on 2026-08-26 (§14.4).** At 5M rows the filter cut Q5
> to eight granules — 64,244 rows, 1.3% of the table. The conclusion may still
> hold at 3.65B rows across 12 partitions, but the reason given above is not the
> one the data shows, and **this table should not be built on it.** Re-run Q5 at
> 50M+ rows spanning more partitions first.

**Open**: whether the correlation table's TTL should match `events` or differ. A
timeline over year-old data is a plausible request, and four slim rows per event
for a year is affordable. Decide together with §9.

---

## 8. AI search (R5)

Two features usually conflated. They have nothing in common architecturally and
should be planned separately.

### 8.1 Natural language → filters — do this first

The model reads the schema, the project's `attribute_key_types` catalogue and
current facet values, and emits a **validated `EventFilters` object** — not SQL.

- Zero storage impact. No schema change. No new table.
- It reuses the entire existing filter pipeline, including the Zod schema that
  already exists (`event-filters.schema.ts`).
- **It cannot inject SQL**, because it never produces SQL. The output is parsed
  by `eventFiltersSchema.safeParse` like any other untrusted input, and an
  invalid emission degrades to "I could not build that filter" rather than to a
  query.

This is the cheap 80%. Build it before anything involving vectors.

### 8.2 Semantic search — embed templates, not events

Embedding 10M events/day is not a real option: 10M model calls a day, and the
vectors would outweigh the data.

**Embed the templates instead.** There are ~18k distinct templates per day
against 10M events — a ~550× reduction. Semantic search becomes:

1. embed the query,
2. vector search over `message_templates` (small — Postgres + `pgvector`, or a
   small ClickHouse table with a `vector_similarity` index),
3. take the matching `template_hash` values,
4. `WHERE template_hash IN (…)` against `events`, backed by `idx_tmpl`.

The result is semantic recall with exact, filterable, countable results, and the
embedding bill is proportional to *vocabulary* rather than to *volume*.

**This is the strongest argument for keeping `normalizeMessage` and the
fingerprint.** They were built as a performance workaround for the Postgres
rollup; under R5 they become the thing that makes semantic search affordable at
all. Do not delete them with the rest of the rollup machinery.

Since the template set is small, the vector store choice does not affect the
events schema and can be deferred.

---

## 9. Retention

Three independent dials, which is the point:

| Data | TTL | Rationale |
|---|---|---|
| `events.stack_trace`, `events.context` | 30 days (column TTL) | The two fattest columns. Resetting them to `''` keeps the event searchable and countable while removing most of its weight |
| `events` rows | `retention_days`, per project | The tunable one |
| `events_by_template`, `p_minute` | 1 year+ | Charts and trends for a year cost single-digit gigabytes |

**"A year" is affordable because it does not mean a year of everything.** That
split is the actual answer to "retention is unknown": you do not have to know
today, because the expensive dial and the valuable dial are separate.

**Per-project retention via a materialized column.** `retention_days` is written
at insert from the project's setting, so the TTL expression is a plain function
of table columns — no dictionary lookup inside a TTL, a construct this plan
deliberately avoids depending on. Cost: changing a project's retention affects
only new rows until `ALTER TABLE events MATERIALIZE COLUMN retention_days` runs.
A mutation, but a rare and per-project one.

**Named cost**: row-level TTL means `ttl_only_drop_parts` cannot be used — parts
hold rows of mixed expiry, so expiry rewrites parts during merges instead of
dropping them. That is continuous background work. If per-org retention turns out
to need only two or three tiers rather than an arbitrary day count, one table per
tier with `DROP PARTITION` is strictly cheaper and should be preferred.

---

## 10. Write path

**`async_insert = 1`, `wait_for_async_insert = 1`.**

Every `INSERT` creates a part; the best-practice rule wants 10k–100k rows per
insert and ~1 insert/second. `ingestSingle` writes one row and `ingestBatch` caps
at 500, so without server-side buffering this table hits "too many parts"
immediately. Async insert buffers server-side and builds properly sized parts
from many client requests.

`wait_for_async_insert = 1` is not the cautious choice; it is the only defensible
one for this product:

| | `= 1` | `= 0` |
|---|---|---|
| Latency | + up to `async_insert_busy_timeout_ms` (~200 ms) | network only |
| Durable when 200 returns | yes | **no** |
| Flush errors reach the client | yes | no — only `system.asynchronous_insert_log` |
| Read-after-write | works | broken |

A logging service's entire promise is "the event you sent is here". With `= 0`,
someone debugging an incident cannot distinguish "my code didn't log it" from
"your service dropped it", and that failure poisons trust in every other number
on the page.

Read-after-write also keeps the four e2e specs that ingest and immediately assert
(`ingest`, `events`, `dashboard`, `overview`) working unchanged.

**If 200 ms proves unacceptable, the answer is `POST /api/ingest/batch`, not
`= 0`.** 500 events per request amortizes to 0.4 ms each. The endpoint exists.

**Rejected: a Node-side batcher.** It reimplements `async_insert` inside a
process that may have several replicas, each with its own buffer and its own
crash window.

**Adopt `insert_deduplication_token`.** SDKs retry on timeout, producing
duplicates — a defect Postgres has today too, since each retry generates a fresh
UUID. A token derived from the batch lets ClickHouse discard the repeat. Its
interaction with async inserts (`async_insert_deduplicate`) is version-dependent
and belongs in Phase 0.

---

## 11. Testing — the cost nobody budgets

`PROJECT.md` §11 says an integration test is for what the query-builder mock
cannot express, "today that means raw `db.execute(sql`…`)`".

**There is no Drizzle dialect for ClickHouse. The entire events read path becomes
raw SQL.** By this repository's own rule, almost all of it becomes `.itest.ts` —
and `npm run test`, which must work with no Docker running, stops covering it.

What limits the damage: the two hardest pieces are **pure functions** and stay
unit-tested.

- The **filter compiler** — `EventFilters → { sql, params }`, one module used by
  the events list, the facets, the alert evaluator and the custom widgets. Its
  output *is* its behaviour, so asserting on it is not testing implementation.
- The **search parser** (§5) — query string → predicate tree.

Everything that executes SQL moves to `.itest.ts` against a ClickHouse container,
and `test:it` gains a second service. Budget for the integration suite roughly
doubling.

**Parameter binding becomes a security boundary.** Drizzle used to guarantee it.
`@clickhouse/client` has `query_params` (`{name:Type}`); every user-supplied
value must go through it, with no exceptions and no string interpolation. This
needs its own section in `docs/reference/security.md`, alongside the note that
the `events → projects` foreign key and the `innerJoin(projects) WHERE
deleted_at IS NULL` defense-in-depth in `listEvents` both cease to exist —
project resolution moves entirely to the Postgres authorization path that already
runs first.

---

## 12. Phases

No dual-write and no backfill: there is no data. One branch, ordered commits.

| Phase | Work | Gate | Est. |
|---|---|---|---|
| **0** | Experiments (§13). **Nothing else starts until `ORDER BY` is settled** | all §13 answers recorded here | 1 d |
| **1** | `events` DDL, migration runner, compose service, env, healthcheck, memory limits | migrations apply from clean | 1–2 d |
| **2** | Write path: `@clickhouse/client`, async insert, UUIDv7, Zod `.min(1)`, dedup token. Delete `markRollupDirty` / `recordEnvironments` from ingest | ingest e2e green | 1–2 d |
| **3** | Filter compiler + search parser (pure, unit-tested), then `listEvents`, `getEventById`, facets, `alert-evaluator` onto it | events + alerts e2e green | 3–4 d |
| **4** | Rewrite `event-aggregations.service.ts`. Delete the rollup service, boundary service, backfill, registries, partman job, migrations 0007–0015 | dashboards e2e green; `tsc`/lint/test clean | 3–4 d |
| **5** | `p_minute` projection, `events_by_template` MV, `events_by_correlation` MV — each added only after its tier-2 cost is measured | measured before and after | 2 d |
| **6** | TTL + `retention_days` wiring, ClickHouse backup, `docs/reference/*` (all seven files), `security.md` §11 note, `PLAN.md` §17 entry | `WORKFLOW.md` §1 table satisfied | 2 d |

**~13–17 days.**

**Keep `shared/utils/ttl-cache.ts` and the read cache.** Its argument was never
query speed — it is that 100 readers on a 30-second refresh should not compute
one identical answer 200 times a minute. ClickHouse does not change that.

**R4, R5 and the custom-widget builder are separate features**, not part of this
migration. The migration's job is to make them possible; §7 and §8 exist so the
schema does not have to change when they arrive.

---

## 13. Phase 0 — what must be measured, not argued

| # | Question | Method | Blocks |
|---|---|---|---|
| 1 | Is `ORDER BY (project_id, timestamp, id)` right, or does Q1-with-level-filter need `level` in the key? | Load a synthetic corpus, `EXPLAIN indexes = 1` on Q1–Q7 against both candidates | **Everything.** Irreversible |
| 2 | Is a JSON subcolumn read cheaper than a Map, and by how much? (**Partly answered 2026-08-26** — `GROUP BY` needs a typed accessor, see §4.3. The cost comparison is still open) | `Q4-json` / `Q4-dyn` / `Q4-map` in the lab. Compare `read_bytes`, not `read_rows` | §4.3; fallback is three Maps, which costs R3 |
| 3 | Real compression ratio | `system.columns` on the corpus | The 220 GB estimate in §1.1 is an estimate, not a measurement |
| 4 | `uniq(user_agent)` | one query on real traffic | `LowCardinality` or not |
| 5 | Distinct templates **per hour** | one query | `events_by_template` sizing |
| 6 | Does `insert_deduplication_token` work with `async_insert` here? | insert the same batch twice | §10 |
| 7 | Actual tier-2 cost: org-wide 30-day `GROUP BY attributes.x` | one query on the corpus | The R3 product decision in §6.2 |

The corpus can come from `scripts/`, which already has ingest load generators.

---

## 14. Phase 0 results — first run, 2026-08-26

ClickHouse **25.3.14.14**, 5,000,000 rows, 10 projects, 30 days, seed 20260826,
container capped at 3 GiB. One laptop, one node, synthetic corpus. Read the row
and byte columns; the milliseconds measure this machine.

Four of these correct something written above. They are recorded here rather
than edited into place, so the reasoning that turned out wrong stays visible.

### 14.1 `ORDER BY`: candidate A wins, and wider than argued

| | events_a rows / MB | events_b rows / MB |
|---|---|---|
| Q1-plain | **15,388 / 0.7** | 416,154 / 31.5 |
| Q1-level | **17,697 / 0.9** | 416,154 / 30.9 |
| Q1-attr | **15,388 / 0.9** | 416,154 / 41.7 |
| Q1-msg | **23,580 / 2.1** | 416,154 / 46.0 |
| Q2/Q3/Q4 | tie | tie |
| Q7-point | 16,363 / 0.3 | **8,192 / 0.6** |

**`ORDER BY (project_id, timestamp, id)` is settled.** §3.2 predicted B would
lose on Q1-plain and win on Q1-level. It loses on Q1-level too, by 23×.

The reason is worth keeping, because it generalises: every Q1 variant ends
`ORDER BY timestamp DESC LIMIT 51`. Under B the sort key is
`(project_id, toStartOfHour(timestamp), level, timestamp, id)`, so rows are not
in timestamp order — `optimize_read_in_order` cannot apply, and the engine must
read the whole 7-day range for the project and sort it before it can know which
51 rows to return. Pruning by `level` inside each hour bucket saves nothing when
every hour bucket in the range still has to be opened. **A sort key that breaks
the ordering a `LIMIT` depends on cannot be rescued by the pruning it buys.**

Candidate B's only win is Q7, the point lookup, at 8,192 rows against 16,363 —
one granule against two, on a query that already costs 0.3 MB.

### 14.2 Storage: the §1.1 estimate was optimistic

**83.5 bytes/row measured**, against the ~40–60 assumed. A year at 10M/day
projects to **~0.30 TB**, not the 150–220 GB in §1.1. **It does not fit the
240 GB disk.**

And the measurement flatters itself: `stack_trace` compresses 65× and `context`
14× because the generator emits near-identical strings for both. Real ones vary,
so the true figure is higher, not lower.

Where the bytes are:

| column | % of table | bytes/row | ratio |
|---|---|---|---|
| `request_id` | **24.2%** | 19.3 | 1.9 |
| `id` | **20.2%** | 16.1 | **1.0** |
| `attributes` (JSON) | 9.3% | 7.4 | 3.4 |
| `ip` | 6.5% | 5.2 | 3.1 |
| `message` + `message_lower` | 8.4% | 6.8 | 8.2 |

**Two random-UUID columns are 44% of the table.** That reframes the storage
problem: it is not the log text, it is the identifiers.

- `id` at ratio **1.0** is §4.2 measured. UUIDv4 does not compress at all, and
  it is a fifth of the table. UUIDv7 moves from "free, no downside identified"
  to the single cheapest win available.
- `request_id` is the **largest column in the table** and was not discussed
  anywhere above. It is a 36-character string holding what is almost always a
  UUID, unique per row, so it compresses barely at all. `trace_id` holds the
  same kind of value and compresses **14.4×** — because eight events share one.
  Uniqueness, not the type, is the cost.

  Open, and new: store `request_id` as `UUID` when it parses as one (16 bytes
  against 36) with a `String` shadow for clients that send something else; or
  accept it. Not a schema-blocking question — a column can be added or retyped
  later — but it is worth more than most of §4.1.

`message_lower` costs a full duplicate of `message` (3.4 bytes/row). Cheap here,
and worth re-checking against real messages before §5 treats it as free.

### 14.3 JSON vs Map: settled on the second run — **take the JSON type**

The first run gave JSON only a 15% edge and could not tell whether §4.3 was
wrong or the corpus was. It was the corpus: three attribute keys per project,
where a `Map` has almost nothing to skip past. Re-run at **18 keys per project**
(180 disjoint keys across ten projects, the band real projects sit in):

**Q4, 7-day range, one project:**

| | 3 keys/project | 18 keys/project |
|---|---|---|
| `attributes.order_id.:String` (typed subcolumn) | 16.9 MB | **16.2 MiB** |
| `toString(attributes.order_id)` (type unknown) | 20.1 MB | 19.3 MiB |
| `attr_str['order_id']` (the Map fallback) | 19.9 MB | **59.0 MiB** |

**Full-column scan over all 5M rows:**

| | read | duration | peak memory |
|---|---|---|---|
| JSON typed subcolumn | **59 MiB** | **24 ms** | 4.9 MiB |
| the two Map columns | 944 MiB | 284 ms | 8.4 MiB |

**16× less read, 12× faster.** And the shape is the point, not the ratio:
**JSON's cost did not move when the attribute count grew six-fold** (16.9 →
16.2), while the Map's tripled (19.9 → 59.0). That is precisely the claim §4.3
makes — a subcolumn is read on its own, a Map is paid for whole — and it is
invisible until the corpus is wide enough to show it. At 30 attributes the gap
would be wider again.

Storage is a wash, and slightly favours JSON:

| column | compressed | bytes/row |
|---|---|---|
| `attributes` (all 18 keys) | 244 MiB | 51.2 |
| `attr_str` + `attr_num` (12 keys — no booleans) | 258 MiB | 54.2 |

JSON stores 50% more keys in 5% less space.

**§4.3 stands and the three-Map fallback should be dropped as the plan of
record.** The correction is to the first run's conclusion, not to §4.3.

The typed accessor is worth ~16% over the untyped cast on top of making the
query legal at all — which is `attribute_key_types` earning its promotion twice.

### 14.3.1 The counterweight: a wide JSON column costs on the write path

Measured on the same run, and it is the one argument against:

- **Insert throughput halved**: 93k rows/s at 3 attributes, **47.6k/s at 18**.
  Still ~4× the 10M/day target rate (116/s), so not a capacity problem — but it
  is not free either, and real ingest does more per row than this loader.
- **A bulk `INSERT … SELECT` over one month exceeded the 3 GiB ceiling** at 18
  attributes where it succeeded at 3, on a freshly restarted container.
  Reproduced twice. The copy now runs per **day**.

The second is narrower than it looks. Reads of the same column peak at **under
5 MiB** — the cost is in materialising 180 dynamic subcolumns for a bulk copy,
not in querying them. Production has no backfill to run (§2: there is no data to
migrate), so the operation that fails is one this migration never performs.
Worth knowing before someone writes a re-partitioning script, not a reason to
choose Maps.

### 14.3.2 It is the path count, and it is a multi-tenancy ceiling

`lab/clickhouse/probe-json-memory.mjs`. Six arms, **500k rows and 18 keys per
row in every one**; only the number of distinct key *names* in the table changes,
or only the length of the values does. Each arm ran against a **destroyed and
recreated** server — see the note at the end of this section.

| arm | distinct paths | bytes written | ingest | bulk `INSERT … SELECT` |
|---|---|---|---|---|
| `p18` | 18 | 120 MiB | 109,769 rows/s | **663 MiB peak** ✓ |
| `p180` | 180 | 180 MiB | 60,321 rows/s | **FAILED** > 3 GiB |
| `p360` | 360 | 155 MiB | 47,295 rows/s | **FAILED** |
| `p720` | 720 | 147 MiB | 43,241 rows/s | **FAILED** |
| `p1800` | 1800 | — | **cannot load at all** | — |
| `w10` | **18** | **1,047 MiB** | 54,124 rows/s | **742 MiB peak** ✓ |

**Compare `w10` against `p180`.** `w10` writes **5.8× more data** and copies
fine, at 12% more memory than the 18-path baseline. `p180` writes **5.8× less**
and cannot copy at all. Width is nearly free; paths are not.

Ingest throughput tells the same story and is indifferent to volume: it falls
monotonically with path count (110k → 60k → 47k → 43k → failure) while `w10`,
writing 5.8× the bytes of `p180` across 18 paths, is *faster* than `p180`.

**`max_dynamic_paths` is not the constraint.** It was 8192 in the probe and
2048 in §4.3's schema; the failures start at 180. The binding limit is memory
per path, and it bites an order of magnitude earlier than the documented
ceiling.

**What actually fails, and what does not:**

| operation | verdict |
|---|---|
| Normal ingest (async insert, 25k batches) | fine to 720 paths; fails at 1800 |
| Reading **one** typed subcolumn | cheap everywhere — 4–5 MiB |
| Bulk `INSERT … SELECT` | fails from 180 paths up |
| `JSONAllPaths()` — "what paths exist" | fails from 360 paths up |

That last row is a third promotion for `attribute_key_types`: **do not ask
ClickHouse what properties a project has.** Introspecting paths materialises
every path for every row and is far more expensive than reading one. The
registry is the catalogue; the JSON column is storage.

**The consequence for §4.3, stated plainly.** An install's path count is the
sum over *all* projects of their distinct attribute keys — R2 is precisely what
makes it grow. Ten projects at 18 keys is 180; a hundred is 1,800, which could
not be loaded at all at this budget. So:

- **The measured ceiling is a tenant ceiling, not a data ceiling.** More events
  per project cost nothing extra; more projects with their own key names do.
- **This is the one property the three-Map fallback has and JSON does not.** Map
  keys are *data*, not schema, so they carry no per-key overhead and no ceiling.
  §14.3 dropped the fallback on a 16× read advantage, and that advantage is real
  — but the trade is now known to be *read cost against tenant scaling*, not a
  free win.
- **Ingest capacity is not the worry.** 43k rows/s at 720 paths is 370× the
  10M/day target rate of ~116/s. The worry is headroom for anything that touches
  many paths at once.

**Recommendation, revised:** take the JSON type, and treat **total distinct
attribute keys across the install** as a monitored quantity with an alarm well
below 1,000 — not `max_dynamic_paths`, which will not warn in time. Re-measure
before onboarding tenants past that. If the product targets many tenants with
freely-chosen attribute keys, this decision needs reopening, and §14.3's
numbers are what it would be reopened against.

**Caveat on all of the above**: one node, a 3 GiB cap, 500k-row bulk operations.
Production gets whatever budget the host allows and performs **no bulk copy at
all** (§2 — there is no data to migrate). The transferable finding is the
*scaling*: per-path memory is roughly linear and independent of data volume.

**Method note, because the first two attempts were wrong.** Running the arms in
one process gave nonsense: the third failed reporting `current RSS: 3.00 GiB`
before doing any work, because earlier arms were still resident. `docker compose
restart` was not enough either — the data volume survives it, and an empty
server came back at **2.41 GiB**. Only `down -v` between arms gave every arm the
same baseline, which then held steady at 490–498 MiB across all six. Two rounds
of numbers were discarded.

### 14.4 Timelines: the bloom filter did better than §7 assumed

Q5 (`project_id + trace_id`, no time bound) read **64,244 rows** on A — eight
granules out of 610, to return ~8 events. §7 says the filter "cannot avoid
opening every part in the retention window", and at this size that is not what
happens.

The amplification is still ~8,000×, and the corpus is 5M rows in 2 partitions
against a target of 3.65B in 12. **The section's conclusion may well hold and
its stated reason does not.** Do not build `events_by_correlation` on this
evidence; re-run Q5 at 50M+ rows spanning more partitions first.

### 14.5 Projections: automatic, but only in the projection's vocabulary

The first `--projection` run changed **nothing** — Q2 and Q3, the two widgets it
exists for, read the identical 412,714 rows with and without it. The projection
was materialized and healthy. It simply was not used.

Isolating when it is:

| query | reads |
|---|---|
| `GROUP BY project_id, minute, level, environment, source` (exact match) | `p_minute` |
| `GROUP BY m, level`, no `WHERE` (subset of keys) | `p_minute` |
| `WHERE toStartOfMinute(timestamp) >= …` | `p_minute` |
| `WHERE timestamp >= …` | **the main table** |

The discriminator is the **`WHERE` clause, not the `GROUP BY`.** A subset of the
grouping keys matches fine. Filtering on raw `timestamp` — a column the
projection does not store — does not, because the filter cannot be evaluated
against projection rows.

Measured on a 6-hour dashboard range, same results either way:

| | rows read | bytes |
|---|---|---|
| `WHERE toStartOfMinute(timestamp) >= now() - 6 HOUR` | **16,384** | 592 KiB |
| `WHERE timestamp >= now() - 6 HOUR` | 585,354 | 13.96 MiB |

**36× on rows, 24× on bytes, decided by how the range predicate is written.**

**§6.1 overstates the case and needs correcting.** "The application writes one
query against `events`" is true; "there is no branch" is true; but the query has
to be written in the projection's terms or the projection is silently skipped.
The saving grace is the failure *mode*: this returns the right answer slowly,
where the Postgres coverage guard it replaces returned wrong answers quickly.
That is still the trade this migration is for — it is just not free.

The practical rule: **the range predicate must be bucket-aligned and expressed
as the projection's own key expression.** Note `toStartOfMinute(ts) >= X`
excludes part of the boundary minute when `X` is not minute-aligned, so the
alignment must happen in `resolveRange()`, not be hoped for.

### 14.6 Every key dimension costs most of the projection's value

The corpus was re-seeded at **3,472 events/minute** (`--days 1`) after the first
run turned out to model the row count but not the *rate* — 5M rows over 30 days
is 116/minute, a sixtieth of the 10M/day target, and a rollup question is
entirely a question about rate.

Two projections over the identical data:

| projection | key | rows | compression | size |
|---|---|---|---|---|
| `p_minute` | `project, minute, level, environment, source` | 716,639 | **7×** | 1.27 MiB |
| `p_lean` | `project, minute, level, environment` | 196,158 | **25.5×** | 345 KiB |

**Adding `source` to the key costs 3.6× of the benefit.** §6.2 says the
arithmetic is the same as Postgres but "the threshold is not… ClickHouse does not
notice". It notices. Not in absolute size — 1.27 MiB is nothing — but in the
compression ratio, which *is* the projection.

The binding constraint is cells, not rows: `1440 minutes × 10 projects × 5
levels × 3 environments × 5 sources` is 1.08M cells per day, against 10M events.
Roughly nine events per cell is the ceiling on what any projection with that key
can compress, however much data arrives.

So `widgets.md`'s original rule survives the engine change almost intact: **a
dimension enters the key only if a filter needs it, and each one is paid for.**
The plan was wrong to treat ClickHouse as making that rule cheap. What
ClickHouse actually removes is the *correctness* machinery — the watermark, the
coverage interval, the union with a raw tail — not the design discipline.

Which key to ship is now a real decision rather than an assumption, and it
should be made against R1's actual filter list rather than guessed at. A second
projection is also an option the plan did not consider: two narrow ones may beat
one wide one, since a query uses whichever matches.

### 14.7 Still unanswered

- **Experiment 4** (`uniq(user_agent)`) needs real traffic. The corpus has 4.
- **Experiment 6** (`insert_deduplication_token` with `async_insert`) not run.
- **Experiment 7**: Q4-org read all 5M rows for a 30-day org-wide group-by, at
  102 MB and 10 ms. Too small to decide the range-cap question in §6.2 — that
  needs a corpus at least ten times this one.
- The **projection** run (`measure.mjs --projection`) has not been done.

### 14.6 Two things the lab cost, worth knowing

Both were mine, and both are the kind of failure that produces confident wrong
numbers rather than an error:

- Mounting `./config.d` **over** `/etc/clickhouse-server/config.d` hid the
  image's own `docker_related_config.xml`, the only place `listen_host` is set.
  ClickHouse then bound 127.0.0.1 inside the container. The container's
  healthcheck runs inside it and reported **healthy** throughout, while every
  request from the host failed as "Empty reply from server".
- `INSERT INTO events_b SELECT * FROM events_a` exceeded the 3 GiB cap at 5M
  rows. The fix was to copy per partition, not to raise the cap — the cap is
  what makes the numbers transferable to an 8 GB host shared with Postgres.

---

## 15. What this costs

Recorded so the decision is not remembered as free.

- **Two datastores**: two migration systems, two backups, two healthchecks, two
  things to tune on one 8 GB host. Postgres's working set shrinks to metadata and
  pg-boss, so `shared_buffers` should come back down — plan roughly PG 1 GB,
  ClickHouse 3–4 GB, app 1.5 GB.
- **No transactional boundary** between an event and anything else, and no
  foreign key from `events` to `projects`. Both are already effectively true.
- **Drizzle stops helping** on the largest table. Raw SQL, hand-maintained types,
  and parameter binding as a rule rather than a library guarantee.
- **Full-text search is reimplemented**, not ported — ~120 new lines against
  ~1,450 deleted.
- **The unit-test surface shrinks** (§11).
- **The performance case was already closed.** This buys storage, capability, and
  the deletion of a class of correctness bug. It does not buy a faster dashboard,
  and claiming otherwise would be false.
