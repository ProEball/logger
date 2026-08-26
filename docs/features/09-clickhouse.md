# 09 — ClickHouse: events leave Postgres

**Status**: **Phase 4 done 2026-08-26** — **events are in ClickHouse and nowhere else.** Every read and every write goes there; the Postgres `events` table, its partitioning, both rollups, the two registries, the two maintenance jobs and the dual write are all deleted (§12.4). Phase 0 run 2026-08-26 — see §14, which corrects §1.1, §3.2, §6.1, §6.2, §7 and, in §14.8, §10 itself. Settled: `ORDER BY`; the deduplication token; the search grammar and its tokenizer (§12.3); where the message template lives (§12.4). Chosen with a named ceiling: the `JSON` type (§14.3, §14.3.2). Refuted: two claims about projections, and the claim that a token can be derived from the batch. Next: **Phase 5, the projection and the two materialized views** — each of which §12 requires to be measured before and after, and **nothing on the read path has been measured on ClickHouse yet**.
**Prerequisite**: none — the staging host was destroyed, so there is no data to migrate.

> This is a **planning doc** (`WORKFLOW.md` §1: intent belongs here, not in
> `docs/reference/`). When a phase ships, its behaviour moves into
> `docs/reference/` and this file records only what was decided and why.
>
> **Phase 1's behaviour has moved** — the shipped table, its two irreversible
> choices and the two operational limits are in
> [`architecture.md`](../reference/architecture.md); the container, env schema and
> tuning knobs are in [`stack.md`](../reference/stack.md); the readiness check is
> in [`api.md`](../reference/api.md); the topology and boot order are in
> [`misc.md`](../reference/misc.md) and [`OPERATIONS.md`](../OPERATIONS.md).

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

> **Built 2026-08-26, and this section understates the risk (§12.3).** The
> parser is indeed pure and unit-testable. What is not testable that way is the
> **tokenizer**: `hasToken` *raises* on an empty needle or one containing a
> separator, so a term split differently from ClickHouse's own rule is a 500 on
> the events page rather than a wrong result. The rule turned out to be "ASCII
> alphanumeric, or any code point at or above U+0080" — `_` splits, `café` does
> not — and it is checked against the server's `tokens()` in the integration
> suite. The table above is also incomplete on one point: a bare term of two or
> more tokens (`foo_bar`) gets the `position` check as well, which makes it
> stricter than `<->`.

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

> **Measured 2026-08-26 (§14.8), and two of those three sentences are wrong.**
> The interaction with `async_insert` is a non-issue — deduplication behaves
> identically with and without it, and `async_insert_deduplicate` is a
> Replicated-table knob that changes nothing here. What *is* an issue was not
> named at all: on a plain `MergeTree` the token is **accepted and ignored**
> unless the table carries `non_replicated_deduplication_window`, which
> defaults to `0`. Phase 1 shipped the table without it, so this paragraph as
> written would have produced a feature that silently did nothing.
>
> And **"a token derived from the batch" cannot be built.** The token wins over
> the block checksum, so a content-derived token discards two genuinely
> different requests whenever their bodies match — which for a logging service
> is constant. The token has to come from a caller-supplied `Idempotency-Key`;
> §12.2 has the reasoning.

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
| **0** ✅ | Experiments (§13). **Nothing else starts until `ORDER BY` is settled** | all §13 answers recorded here | 1 d |
| **1** ✅ | `events` DDL, schema runner, compose service, env, healthcheck, memory limits | schema applies from clean | 1–2 d |
| **2** ✅ | Write path: `@clickhouse/client`, async insert, UUIDv7, blank-field normalisation, dedup token. **Not** the deletion of `markRollupDirty` / `recordEnvironments` — see §12.2 | **all 73 e2e green**, not only ingest | 1–2 d |
| **3** ✅ | Filter compiler + search parser (pure, unit-tested), then `listEvents`, `getEventById`, facets, `alert-evaluator` onto it | events + alerts e2e green — **a gate that turned out to prove little, see §12.3** | 3–4 d |
| **4** ✅ | Rewrite `event-aggregations.service.ts`. Delete the rollup service, boundary service, backfill, registries, partman job | dashboards e2e green — **and that gate proved nothing until the suite was rewritten, see §12.4** | 3–4 d |
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

## 12.1 Phase 1 as built — what changed against the plan

Done 2026-08-26. The table, the container, the client, the env schema and the
healthcheck all landed as §4 and §12 describe. Three things did not go as
written, and they are recorded here rather than edited into §12 so the plan
stays readable as what was planned.

**"Migration runner" became "no migrations at all."** §12 assumed one; the user
called it instead — the database is torn down and rebuilt, so a chain describing
how it got somewhere is worth nothing. `core/db/migrations/0000`–`0015`,
`migrate.ts`, `migration-status.ts` and two scripts were deleted; each store now
has one file describing its end state, applied by `core/db/bootstrap.ts`. The
timing is what makes it defensible — see `PLAN.md` §17 for the reasoning and,
more importantly, for the condition under which it has to be reopened. It also
removes work from Phase 4: four of those sixteen migrations existed only to
build things Phase 4 deletes.

**The `events` DDL shipped without its TTL and without the `retention_days`
wiring.** §4's table carries `TTL timestamp + toIntervalDay(retention_days)` and
30-day column TTLs on `context`/`stack_trace`. Those are Phase 6 work (§9), and
adding a TTL to an empty table ahead of the code that sets `retention_days` would
mean shipping a retention policy nobody had measured. The column exists with its
default; the TTL clauses do not. Adding them later is an `ALTER`.

**The readiness probe had to ask a different question than the obvious one.**
On Node, `@clickhouse/client`'s default `ping()` hits the built-in `/ping`
endpoint, which **does not verify credentials** — a wrong password or a missing
database passes it, and every real query then fails. It also does not *throw*:
failure comes back as `{ success: false, error }`, so `await client.ping()` on
its own is a healthcheck incapable of failing. Both were found while writing
the test, not before; the shipped check is `ping({ select: true })` with the
result inspected. Same shape as the `migrations` defect this repository already
has on record — a probe reporting healthy for a reason unrelated to the question.

**Two things cost time that §12 did not budget for, both configuration:**

- `from_env` substitution in a ClickHouse config file **fails to start the
  server** if the element already carries a value and lacks `replace="replace"`
  — `Element <level> has value and does not have 'replace' attribute`. The
  fallback-inside-the-element pattern that makes the knobs optional is exactly
  the pattern that triggers it.
- Playwright starts `webServer` **before** `globalSetup`, so the e2e database
  cannot be created there. It is a script chained into `npm run test:e2e`
  instead. This closed a gap `PROGRESS.md` had carried for two weeks.

**Verified from empty**: `docker compose down -v` then `up`, then the bootstrap —
20 Postgres tables with `events` partitioned into 16 partitions and pg_partman
registered at 30-day retention, and the ClickHouse table with the settled sort
key, all seven skip indexes, `Enum8`/`IPv6`/`JSON` types intact. Re-running the
bootstrap is a no-op. `GROUP BY attributes.order_id.:String` — R3's shape —
runs; the untyped `attributes.order_id` reads back as `Dynamic`, confirming
§4.3's finding that the typed accessor is what makes the query legal.
`tsc` 0, lint 0, **772** unit tests, 193 integration tests, 73 e2e specs. The
four guards added for this phase were mutation-checked rather than trusted:
dropping `select: true`, swallowing a failed ping, and removing either
empty-schema-file guard each fail the suite.

---

## 12.2 Phase 2 as built — what changed against the plan

Done 2026-08-26. The client settings, UUIDv7, the row mapper, the blank-field
normalisation and the deduplication token all landed. Four things went
differently, recorded here rather than edited into §10 and §12 so the plan
stays readable as what was planned.

**It is a dual write, and `markRollupDirty` / `recordEnvironments` stayed.**
§12 has Phase 2 cutting ingest over to ClickHouse and deleting the derived-table
updates, with "ingest e2e green" as its gate. That gate is the tell: the other
72 specs would have been red for the length of Phases 3 and 4, because every
read still comes from Postgres. Writing to both instead keeps the whole suite
green at every commit, so a regression introduced in Phase 3 is distinguishable
from breakage put in on purpose.

It also buys something the plan did not consider. Both stores hold the **same
rows**, produced by one `enrichEvent` call — same id, same timestamp, same
values — so a rewritten ClickHouse read can be checked against the Postgres one
it replaces on identical data. That is worth more than the ~10 lines it costs.

§12's "no dual-write" is about *data migration*, and remains true: there is no
existing data, so no dual-write **period** is needed to cut over. This is a
different thing with a scheduled end — Phase 4 deletes the Postgres insert,
`updateDerivedTablesSafely`, the Drizzle `events` table and `db/events.sql`
together.

The cost, named: no transaction spans the two stores, so a request that fails
after the ClickHouse write leaves the event in one and not the other and
returns 500. Making that impossible needs exactly the thing §15 says this
migration gives up.

**The deduplication token is an `Idempotency-Key` header, not a hash of the
batch.** §10 says "a token derived from the batch"; experiment 6 (§14.8) shows
that cannot work. The token **wins over the block checksum**, so a second insert
carrying a token ClickHouse has seen is discarded *whatever it contains*. A
content-derived token therefore discards two genuinely different requests
whenever their bodies match — and for a logging service they match constantly:
a heartbeat, a retry loop, the same error twice in a second. `{"level":"info",
"message":"tick"}` sent twice is two events, and content hashing would store one
and report success for both.

Nor can the hash include anything server-side: the id and the arrival time are
what separate those two requests, and equally what separate a retry from its
original. A token containing either deduplicates nothing.

So the caller has to say. Absent the header the behaviour is exactly today's —
duplicates stored, visible, countable. **Losing events silently is strictly
worse than storing a duplicate someone can see**, which is the same trade §10
made when it chose `wait_for_async_insert = 1`.

**The token needed a table setting nobody had written down.** See §14.8: on a
plain `MergeTree` `insert_deduplication_token` is accepted and ignored unless
`non_replicated_deduplication_window` is set, and Phase 1 shipped without it.
The table now carries 10,000.

**`.min(1)` became a normalisation, not a rejection.** §4.1 offered both. An
ingest endpoint returning 400 because a caller sent `""` for a field it never
had to send discards an event to protect a facet list; blank now collapses to
absent instead. The same call is made for `X-Forwarded-For`: §4.1 did not
anticipate that `IPv6` **fails the entire insert** on an unparseable address
(code 676), which for a batch is 500 events lost to one malformed proxy header.
An address that does not parse is stored as `::`.

**What the tests cost, against §11's prediction.** §11 said the integration
suite would roughly double. So far: 90 new unit tests (the mapper, the token,
UUIDv7, the schema change, the dual write) and 15 integration tests. The unit
side held up better than expected because the mapper is a pure function — but
the integration test earned its place immediately, catching three type
rejections that a mocked client accepts: the ISO-8601 timestamp, the
unparseable IP, and an unknown enum value. `test:it` now needs two containers.

**Verified**: `tsc` 0, lint 0, **72 files / 862 unit tests**, **5 files / 208
integration tests**, **73 e2e specs**, `npm run build` clean. The e2e run was
confirmed to have actually reached ClickHouse rather than passing on the
Postgres half alone — `system.asynchronous_insert_log` shows 14 inserts, 237
rows, all `Ok`, in the e2e database. The two guards were mutation-checked:
returning the raw `X-Forwarded-For` value fails 14 integration tests, and
emitting the ISO timestamp fails 10 unit tests.

## 12.3 Phase 3 as built — what changed against the plan

Done 2026-08-26. The filter compiler, the search parser, `listEvents`,
`getEventById`, the facets and the alert evaluator all landed as §12 describes.
Five things went differently.

**The compiler lives in `core/`, not in a feature.** §12 does not say where, and
`PROJECT.md` §7 puts data access in `services/`. But `features/events` and
`features/alerts` both need it and a feature may not import another (§2.1), so a
compiler inside either would have forced the duplication it exists to remove —
which is exactly what was already there: the evaluator held a second copy of the
events page's clause builder, eleven fields written twice, with no test
comparing them. `core/clickhouse/` now holds the query layer beside the client,
the same reason `event-row.types.ts` moved there in Phase 2.

**§5's parser is two modules, and the tokenizer half was the risk.** §5 sizes
the work as "a ~120-line TypeScript parser" turning the `websearch` grammar into
a predicate tree, and that part was uneventful. What it does not mention is that
**`hasToken` raises** — `BAD_ARGUMENTS: Needle must not contain whitespace or
separator characters`, and separately on an empty needle. A term the parser
splits differently from ClickHouse's tokenizer is therefore a **500 on the
events page**, not a wrong row count.

So the splitting rule had to be measured rather than assumed, and it is not the
obvious one: a token character is an ASCII letter or digit, **or any code point
at or above U+0080**. `_` splits (`foo_bar` is two tokens); `café`, `привет`,
`a—b` and `a😀b` are each one. `messageTokens` is checked against the server's
own `tokens()` on a battery of inputs in the integration suite, because a
disagreement is not something a unit test can see.

Three deliberate divergences from `websearch_to_tsquery` came out of this, all
recorded in `docs/reference/logging.md#message-search`: a term of two or more
tokens additionally requires its literal text (so `foo_bar` does not match
`foo bar`); a term with no tokens at all becomes a substring test rather than an
empty query matching nothing; a single-token term is matched by its token alone,
which is what keeps `timeout.` finding `timeout`.

**The `projects` join was kept, not lost.** §12 says nothing about it and
`security.md` had already written it off as a casualty of the second store.
Instead each read issues the `deleted_at IS NULL` check as a Postgres
primary-key lookup **concurrently** with the ClickHouse query — no added
latency, and the property survives. `security.md` has been corrected in place.

**Two filter behaviours changed on purpose, and one of them fixes a silent
bug.** An attribute filter now compares `toString` of the stored value against
the string from the URL. Postgres used `attributes @> '{"k":"v"}'::jsonb`, which
is type-strict, so a filter on a *numeric* attribute matched nothing at all and
said nothing about it. The other: a filter for the empty string additionally
asserts the path exists, because `toString` of an absent path is also `''`.

**The Phase 3 gate was nearly worthless, and that is worth recording.** "Events
+ alerts e2e green" — both were green, and would have been with the events page
completely broken. Six of `events.spec.ts`'s nine tests assert against Postgres
directly, and the dual write keeps those rows there whatever the read path does;
`alerts.spec.ts` covers rule CRUD and never evaluates a rule. Only two tests
went through the new path. Two more were added (a level filter and a row click,
the latter being the only end-to-end exercise of `getEventById`), and the real
coverage is the 46-test integration file. **A gate phrased as "suite X stays
green" is only a gate if suite X exercises the thing being changed** — worth
checking for Phase 4, whose gate is phrased the same way.

**What the tests cost.** 113 new unit tests (the search parser 26, the compiler
23, the reverse mapper 17, the cursor 8, the rewritten evaluator 19, and 20
absorbed elsewhere), 46 integration tests, 2 e2e. §11 predicted the integration
suite would roughly double; it went from 208 to 254 in this phase, and from 5
files to 6.

One of those was not new work but a repair: `alert-evaluator.service.test.ts`
**imported nothing at all** — it declared its own copies of the evaluator's two
decision functions and asserted on those. The evaluator's threshold, its
optimistic-concurrency guard and its notification rules had no coverage, and the
match count could have moved to a different database without a single test
noticing. Same defect as `aggregations.service.test.ts`, and the Stop hook
cannot see this shape either: a test that imports nothing still satisfies "a
sibling test exists".

**Verified**: `tsc` 0, lint 0, **76 files / 945 unit tests**, **6 files / 254
integration tests**, **75 e2e specs**, `npm run build` clean. The e2e run was
confirmed to have actually read from ClickHouse rather than passing on the
Postgres half: `system.query_log` shows 36 `SELECT`s against `events` in
`logger_test`, all `QueryFinish`, 2,160 rows read. Five claims were
mutation-checked — removing the attribute existence guard fails 2 integration
tests, restoring the default 64-bit quoting fails 3, dropping
`reinterpretAsInt64` fails 1, removing the soft-delete guard fails 1, and
breaking the v4-mapped unwrap fails 2 unit tests.

## 12.4 Phase 4 as built — what changed against the plan

Done 2026-08-26. `event-aggregations.service.ts` was rewritten, and the rollup
service, the boundary service, the backfill, both registries and the partman job
were deleted, as §12 describes. **Postgres now holds no event data at all**: the
`events` table, `db/events.sql`, the pg_partman extension, the custom
`db/Dockerfile` that installed it and the dual write went too, which §12 lists
under Phase 2's row rather than this one.

Seven things went differently, and two of them are behaviour changes on screen.

**Half the file was never about the questions.** 1,449 lines to ~660, and every
public signature unchanged, so no caller and no component moved. What
disappeared was a watermark, a coverage interval, a raw tail unioned above it,
four floor checks answering "can this summary be trusted for *this* question",
and two implementations each of `topMessages` and `topSources` chosen at
runtime. §1.2 counted those lines as the cost of a summary table living in a
different table from `events`; that turned out to be exactly right, and the
count was if anything conservative — it did not include the 513 lines of
integration tests that existed only to check which branch a read took.

**`topMessages` had two answers and now has one — the fix §12 does not mention.**
The rollup path grouped by `template_hash`; the fallback grouped
`SUBSTRING(message, 1, 200)`. Those are different questions. The first says
`User *** signed in` occurred 4,000 times; the second says four thousand things
occurred once each. Which one a reader saw depended on whether a rollup covered
the range and on whether an environment filter was active — invisible on screen,
and no test compared them. It groups by `template_hash` always.

**That forced a decision §6.3 had not reached: where the template text lives.**
Grouping by a fingerprint needs a label, and `message_templates` — the Postgres
vocabulary table that supplied it — is one of the tables being deleted. The
normaliser is TypeScript and has no SQL equivalent, so a template that is not on
the row is a group no query can name; the alternative was `any(message)`, which
labels a group of ten thousand with one arbitrary instance. So `message_template`
is now a column on the event, written by the same pass of the normaliser that
computes the hash.

**Measured after the fact, on 300k events from `event-factory.mjs`:** the column
costs **2.00 bytes/row at 13× compression, 4.4% of the table** — against
`message` at 4.85 bytes/row and 5.8×, and `id` at 27.4%. The compression ratio
is the whole reason it is cheap: 2,252 distinct templates against 110,112
distinct messages in that corpus, and the sort key puts near-identical values in
one granule. Note what the corpus is, though — a generator, not real traffic;
the install-wide figure §6.3 quotes is 18,080 templates, and the ratio is what
transfers, not the byte count.

**The fingerprint stopped being folded.** `toSignedBigint` / `toUnsignedBigint` /
`templateHashForStorage` are deleted. They existed because Postgres' `bigint` is
signed and an FNV-1a hash is not, so the same number had to be folded on the way
in and unfolded on the way out — and neither fold is an involution, so applying
one twice or forgetting it once was a silent wrong answer rather than an error.
`UInt64` is the range the hash already lives in.

**The alert webhook's sample events were still on Postgres, and applied a
narrower filter than the count beside them.** Phase 3 moved
`countMatchingEvents` and left `fetchSampleEvents` behind; while it was there it
re-applied only the rule's `levels`, ignoring environments, sources, attributes
and message search. A rule filtering on `source` therefore counted one set of
events and illustrated itself with another. Both go through `compileFilters`
now. Not in §12's list for this phase because nobody had noticed it.

**`(unset)` moved from the bottom of the environment dropdown to the top**, and
this is the second visible change. Postgres ordered by its collation, which
weights punctuation below letters, so the label sorted as if it were "unset";
ClickHouse orders bytewise and `(` is 0x28. Byte order is what that list always
wanted — its sibling in `projectStats` sorted in TypeScript precisely to escape
the collation — so the two agree for the first time.

### The gate proved nothing until the suite was rewritten

§12.3 flagged that Phase 4's gate was phrased exactly like Phase 3's — "suite X
stays green" — and asked for it to be checked. It was, and the answer was the
same: **six of `dashboard.spec.ts`'s eight tests queried the database directly**
(`SELECT level, COUNT(*) FROM events GROUP BY level` and five more of that
shape) and asserted on the rows. They ran no aggregation the application owns
and rendered nothing. The two that opened a browser checked that an `<h2>`
existed and that the empty state contained the word "curl".

The file was rewritten against the rendered page: the KPI totals, the level
breakdown's sum, the template collapse in top messages, the source ranking, the
raw message in recent errors, the onboarding gate, and an environment filter
narrowing every widget at once. Addressing a card by name needed `role="group"`
on `KpiCard` and a named `<section>` on `WidgetCard` — an accessibility
improvement the specs forced, and the same one `overview.spec.ts` forced in
August.

**A gate phrased as "suite X stays green" is only a gate if suite X exercises
the thing being changed.** Twice in a row it did not. Phase 5 and Phase 6 have
gates of the same shape ("measured before and after", "the §1 table satisfied"),
and those at least name an artefact rather than a colour.

### What the tests cost, and one defect only the integration suite could see

**Unit**: 73 files / 912 tests, *down* from 76/945. Deletions outnumbered
additions, which is the shape of this phase. New: `params.test.ts` (5), the
rewritten `ingest.service.test.ts`, `fingerprintMessage`'s tests, the
round-trip's unsigned-fingerprint case. Gone: everything covering the rollup.

**Integration**: 3 files / 156 tests, from 6/254. Three files went with the
rollup and 513 lines came out of the aggregations file. Every remaining
assertion is **unchanged** — same corpus, same expected numbers — which is what
made them useful: a disagreement between the Postgres answers and the ClickHouse
ones surfaced here rather than as a number nobody recognised on a dashboard.

One did, and it is the finding of this phase:

> `SELECT toString(project_id) AS project_id … WHERE project_id IN {p:Array(UUID)}`
> returns **no rows and raises nothing**. ClickHouse resolves a select-list
> alias inside `WHERE`, so the comparison is `String` against `Array(UUID)`.

Every bucket and every per-project count was empty. The SQL is valid; the answer
is merely wrong. A unit test cannot see it, a type checker cannot see it, and
the e2e suite as it stood then could not see it either. None of the three
`toString` calls was needed in the first place — `JSONEachRow` renders a `UUID`,
an `Enum8` and an `IPv6` as strings already — and the rule now lives in the
service: never alias a converted column back to its own name.

**Five claims were mutation-checked** rather than trusted, plus two more against
the unit and e2e suites: dropping `message_template` at ingest fails 8
integration tests and 1 unit test; removing the `(unset)` label from the filter
side fails 1; breaking the owning-project tie-break fails 1; deleting
`LIMIT 1 BY project_id` fails 1; ignoring the requested bucket width fails 13;
labelling a group with `message` instead of `message_template` fails the
dashboard e2e.

The tie-break one **missed on the first run**, and that is worth recording: the
rule that a template logged by two projects is attributed to the busier one had
no coverage at all, because the shared corpus gives every message to exactly one
project. It has a two-project fixture now. Writing it also turned up that
**ClickHouse's UUID ordering is not lexicographic** — it compares two `UInt64`
halves — so "ties break toward the smaller id" no longer means what it meant in
Postgres. The test asks the server which id it considers smaller rather than
assuming, and asserts the tie resolves the same way twice.

### The cost of having no migrations, collected

`PLAN.md` §17 (2026-08-26) accepted "the database is torn down and rebuilt" as
the answer to schema drift and named the condition for revisiting it. One phase
later, that cost arrived in a form worth writing down: an end-state schema file
is applied **additively** and cannot remove a table. Phase 4 deleted six, and
one of them — `events`, with its `ON DELETE RESTRICT` foreign key to `projects` —
then broke `resetDb()` in **every e2e spec** with a constraint violation over
rows nothing writes any more. Correct code, correct file, wrong database.

The integration and e2e databases now drop and recreate themselves, which is
cheap because both are disposable. **The dev database is not**, and nothing
detects or warns about a stale one: after this change a developer has to run
`docker compose -f docker-compose.dev.yml down -v` and `npm run db:bootstrap`.
That is recorded in `architecture.md` and `stack.md` and is the closest thing to
a migration note this repository now has.

### Verified

`tsc` 0, lint 0, **73 files / 912 unit tests**, **3 files / 156 integration
tests**, **75 e2e specs**, `npm run build` clean.

The e2e run was confirmed to have actually exercised the ClickHouse
aggregations rather than passing on something else: `system.query_log` for
`logger_test` shows every aggregation shape — `levelBreakdown` 204, `topMessages` 202,
`eventBuckets` 202, `environmentsInUse` 202, `topMessagePerProject` 190, both
halves of `projectStats` 190, `hasAnyEvents` 27, whole-event reads 26,
`topSources` 12 — and **zero** failed `SELECT`s across 3,086 queries.

**Nothing on the read path has been measured for speed.** The benchmark harness
was rewritten onto ClickHouse and is the "before" run Phase 5 needs; two numbers
in particular are unmeasured and are asserted in this document only as
arguments: that `environmentsInUse` can go back to a 30-day scan because
`environment` is `LowCardinality`, and that grouping by `template_hash` over a
raw scan is cheap. Phase 5 should look at both before adding a projection, not
after.

## 13. Phase 0 — what must be measured, not argued

| # | Question | Method | Blocks |
|---|---|---|---|
| 1 | Is `ORDER BY (project_id, timestamp, id)` right, or does Q1-with-level-filter need `level` in the key? | Load a synthetic corpus, `EXPLAIN indexes = 1` on Q1–Q7 against both candidates | **Everything.** Irreversible |
| 2 | Is a JSON subcolumn read cheaper than a Map, and by how much? (**Partly answered 2026-08-26** — `GROUP BY` needs a typed accessor, see §4.3. The cost comparison is still open) | `Q4-json` / `Q4-dyn` / `Q4-map` in the lab. Compare `read_bytes`, not `read_rows` | §4.3; fallback is three Maps, which costs R3 |
| 3 | Real compression ratio | `system.columns` on the corpus | The 220 GB estimate in §1.1 is an estimate, not a measurement |
| 4 | `uniq(user_agent)` | one query on real traffic | `LowCardinality` or not |
| 5 | Distinct templates **per hour** | one query | `events_by_template` sizing |
| 6 ✅ | Does `insert_deduplication_token` work with `async_insert` here? (**Answered 2026-08-26 — §14.8.** Yes, and the real finding is elsewhere) | insert the same batch twice | §10 |
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
- ~~**Experiment 6**~~ — answered 2026-08-26, see §14.8.
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

### 14.8 Experiment 6 — the token works, and §10 named the wrong risk

`lab/clickhouse/probe-dedup.mjs` and `probe-dedup-window.mjs`, against
ClickHouse 25.3.14.14. Four arms, each inserting the same two-row batch twice.

| arm | rows after the retry |
|---|---|
| plain `MergeTree`, sync insert | **4 — not deduplicated** |
| `non_replicated_deduplication_window = 100`, sync | 2 |
| same, `async_insert = 1`, `wait_for_async_insert = 1` | 2 |
| same, plus `async_insert_deduplicate = 1` | 2 |

**The question §13 asked has a boring answer and the interesting one is next to
it.** Async insert changes nothing: rows 2, 3 and 4 are identical, and
`async_insert_deduplicate` — whose own description says "in the replicated
table" — is inert here. So §10's stated worry was misplaced.

**Row 1 is the finding.** Deduplication is a `Replicated*` feature, and a plain
`MergeTree` opts in only through `non_replicated_deduplication_window`, which
defaults to `0`. Phase 1 shipped the table without it. Setting
`insert_deduplication_token` on that table is **accepted and silently does
nothing** — no error, no warning, retries stored twice. Exactly the shape of
defect this migration exists to remove, and it would have shipped as a working
feature.

**The window is a count, not a duration.** 120 distinct tokens between an
insert and its retry, and the retry gets through at a window of 100. Probed at
100 / 1,000 / 10,000, the boundary is exact every time: the retry deduplicates
at position N and misses at N+1. The `_seconds` and `_for_async_inserts`
variants that would make this a time window exist **only** for Replicated
tables — `system.merge_tree_settings` has no non-replicated equivalent.

So the size is a *rate* decision, and it is close to free:

| window | inserts/s | on disk |
|---|---|---|
| 100 | 16 | 60 bytes/entry |
| 1,000 | 16 | 60 bytes/entry |
| 10,000 | 16 | 60 bytes/entry |

(18,011 bytes for 300 entries, in `store/<uuid>/deduplication_logs/`. The 16
inserts/s is the HTTP round trip plus the ~50 ms async busy timeout and is
identical across the three — the window costs nothing measurable.)

**Shipped: 10,000**, matching ClickHouse's own default for the replicated
async-insert window. At the 10M events/day target that is ~86 seconds of
protection if every event arrives on its own, and hours at 500 per batch.

**Two further properties, both load-bearing for §12.2's design:**

- **The token is per partition**, as the setting's documentation claims —
  verified by inserting one token's worth of data into two months and retrying
  one of them. A batch spanning a month boundary therefore gets an entry in
  each, which is the behaviour you want.
- **The token wins over the block checksum.** Sending *different* data under a
  token already seen discards it. This is what makes "derive the token from the
  batch" unbuildable, and it is why §12.2 requires an `Idempotency-Key` from
  the caller instead.

One thing the probe did not predict, found later by the integration test
failing: turning the window on also enables ClickHouse's **checksum**
deduplication (`insert_deduplicate` defaults to `1`), so a byte-identical block
is discarded with no token at all. Harmless in production — every row carries
its own UUIDv7, so two blocks can only match when the same enriched batch is
inserted twice — but it is a property of the setting rather than of any code,
and nothing except that test would have surfaced it.

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
