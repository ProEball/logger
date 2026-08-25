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
- **`insert_deduplication_token` with `async_insert`** (experiment 6) is a
  behaviour question, not a performance one. Insert the same batch twice through
  `ch.mjs` and count; two lines, but it belongs beside the write path in Phase 2
  rather than in a benchmark harness.
- **Absolute durations at production volume.** 5M rows on a laptop is a shape
  test, not a capacity test.

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
