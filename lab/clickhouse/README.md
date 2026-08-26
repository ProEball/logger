# ClickHouse Phase 0 lab

Answers the seven questions in [`docs/features/09-clickhouse.md` §13](../../docs/features/09-clickhouse.md)
before any of that plan is built.

**Everything here is throwaway.** It is not application code, it ships in no
image, and it is deleted when the decision is made — either because the
migration starts and Phase 1 brings a real client, or because it does not. That
is why it lives in `lab/` and not in `scripts/`.

## Run it

```bash
docker compose -f lab/clickhouse/docker-compose.yml up -d
```

```bash
node lab/clickhouse/seed.mjs --rows 5000000
```

```bash
node lab/clickhouse/measure.mjs
```

Then, to see what the tier-1 projection actually buys:

```bash
node lab/clickhouse/measure.mjs --projection
```

Tear down with `docker compose -f lab/clickhouse/docker-compose.yml down -v`.

`seed.mjs` takes `--rows`, `--projects`, `--days`, `--seed`, `--traceSize`.
5M rows is about 6 minutes and enough for granule skipping to be visible; 30M is
closer to a month of the real target and takes proportionally longer.

## What is being compared

Two tables, identical in every respect except the sort key, filled from one
corpus:

| table | `ORDER BY` |
|---|---|
| `events_a` | `(project_id, timestamp, id)` — the plan's recommendation |
| `events_b` | `(project_id, toStartOfHour(timestamp), level, timestamp, id)` |

`ORDER BY` is the one decision ClickHouse does not let you revise; everything
else in the schema is an `ALTER` away. So it gets an experiment instead of an
argument.

Both tables carry `attributes` **twice** — as `JSON` and as two `Map` columns —
because experiment 2 is a comparison, and comparing two corpora loaded a day
apart would not be one.

## Read `read_rows`, not `ms`

Durations here measure this machine: its page cache, its thermal state, whatever
else is running. Rows and bytes read are properties of the sort key and the skip
indexes and they transfer to the production host.

`docs/PROGRESS.md` records the same 30-day page measuring 222, 1699, 2218 and
437 ms across one day on a shared-CPU box. The first three were measuring
contention. Do not repeat that here.

`measure.mjs` drops the mark cache before every query and the container runs
with the uncompressed cache off, so a repeated query cannot read its own
previous result. The OS page cache is not controlled and cannot be — one more
reason the row counts are the answer and the milliseconds are context.

## What the lab cannot answer

- **`uniq(user_agent)`** (experiment 4) needs real traffic. The corpus has four
  by construction, which says nothing about whether `LowCardinality` is right.
  Run that one against a real install.
- ~~**`insert_deduplication_token` with `async_insert`** (experiment 6)~~ —
  answered 2026-08-26, and it *did* end up here after all, as
  `probe-dedup.mjs` and `probe-dedup-window.mjs`. Both are behaviour probes
  rather than benchmarks: each inserts the same batch twice and counts rows.
  They run against the **dev** container (`docker-compose.dev.yml`), not the lab
  one, because by then the real schema existed and the question was about it.
  Results in `docs/features/09-clickhouse.md` §14.8; the headline is that async
  insert changes nothing and a plain `MergeTree` deduplicates nothing at all
  without `non_replicated_deduplication_window`.
- **Absolute durations at production volume.** 5M rows on a laptop is a shape
  test, not a capacity test.

## The Phase 3 probes

`probe-query-shapes.mjs` and `probe-read-shapes.mjs`, added 2026-08-26. Neither
is a benchmark and neither answers a §13 question: they settle the *shapes* the
filter compiler and the reverse mapper are written against, before they are
written rather than after.

That order is a direct response to Phase 2, where three assumptions about a row
turned out to be wrong and every one of them failed at the wire and nowhere
else. A unit test proves the SQL string; only a server proves the SQL.

```bash
node lab/clickhouse/probe-query-shapes.mjs
node lab/clickhouse/probe-read-shapes.mjs
```

They run against the **dev** container and create and drop their own tables.
Read the printed answers, not a pass/fail — several of these have no right
answer, only a behaviour the code then has to be built around. The five that
changed the design:

- `getSubcolumn(attributes, {key:String})` accepts the path as a **bound
  parameter**, so an attribute key out of a URL never enters the SQL text.
- `hasToken` **raises** on an empty needle or one containing a separator, which
  is what makes the tokenizer rule load-bearing rather than cosmetic.
- `toString` of a JSON path no row has is `''`, indistinguishable from a stored
  empty string without `dynamicType(...) != 'None'`.
- `DateTime64` renders as `2026-08-26 10:00:00.123`, which is not ISO-8601;
  `toUnixTimestamp64Milli` is what JavaScript can read back.
- `output_format_json_quote_64bit_integers = 0` un-quotes integers inside the
  `JSON` column — and rounds a `UInt64` fingerprint to 18446744073709552000,
  which is why it is set per query and never on the client.

## The Phase 4 probe

`probe-aggregate-shapes.mjs`, added 2026-08-26, same purpose and same order as
the Phase 3 pair: settle against a real server what the code will assume, before
it assumes it.

```bash
node lab/clickhouse/probe-aggregate-shapes.mjs
```

Four of its answers changed what got written:

- **`toStartOfInterval` returns `DateTime`, not `DateTime64`**, so
  `toUnixTimestamp64Milli` rejects its result outright. The bucket expression is
  epoch-floor arithmetic instead — the same arithmetic Postgres used, which the
  probe confirms agrees with `toStartOfInterval` on every width the UI asks for.
- **`argMin` cannot wrap an aggregate computed in the same scope.** The
  owning-project rule (`argMin(project_id, (-toInt64(per_project), project_id))`)
  needs its per-project counts to come from a subquery, and an alias that
  shadows the subquery's column silently changes what it ranks.
- **`LIMIT n BY` works and is the idiom** for "the top row per group",
  replacing `ROW_NUMBER() … WHERE rn = 1`.
- **A `UInt64` aggregate comes back quoted.** `count()` is a string in
  `JSONEachRow` unless `output_format_json_quote_64bit_integers` is off — and
  turning that off would round a fingerprint, so every count is read through
  `Number` instead.

One thing it got wrong by omission, and it is the more useful lesson: it did not
probe **alias resolution inside `WHERE`**, so the defect that made every
dashboard query return zero rows reached the integration suite. A probe answers
the questions you thought to ask.

## The corpus has tests, and why

`corpus.test.mjs` runs under plain `npm run test` — no Docker needed, since
`corpus.mjs` performs no I/O.

Every number this lab prints is a statement about the corpus. If the corpus
loses a property the experiments assume — attribute keys that identify one
project, template hashes that describe templates rather than messages, traces
that actually group — then the measurements answer a different question and
nothing in the output would say so.

That is not hypothetical here. `aggregations.service.test.ts` was named after a
service it never imported and read as coverage for two months, and three tests
passed against broken code on 2026-08-20. A lab whose corpus is wrong is the
same failure with a wrong `ORDER BY` at the end of it — and `ORDER BY` is the
one thing that cannot be fixed later.

Both load-bearing assertions were verified by breaking the generator and
confirming they fail: hashing the message instead of the template, and drawing
the Map columns independently of the JSON bag.

## Connection

`ch.mjs` reads `CH_URL`, `CH_USER`, `CH_PASSWORD`, `CH_DATABASE` and defaults to
the compose file above. It is ~50 lines of `fetch` against ClickHouse's HTTP
interface rather than `@clickhouse/client`, deliberately: Phase 0 decides
whether this migration happens, and adding the dependency first would make the
question feel already answered.
