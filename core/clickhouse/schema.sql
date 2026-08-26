-- The complete ClickHouse schema, built from empty.
--
-- Same rule as db/schema.sql: no migrations. The database is torn down and
-- rebuilt, so this file describes the end state rather than a path to it.
-- Applied by core/db/bootstrap.ts on every start; every statement is
-- idempotent.
--
-- `ORDER BY` and `PARTITION BY` are the two choices that cannot be changed
-- without a full re-insert. Both were settled by measurement, not argument —
-- docs/features/09-clickhouse.md §14.1. Everything else here (codecs, skip
-- indexes, TTL, projections) is alterable on a live table.
--
-- Phases 5 and 6 add the projection, the two materialized views and the TTL;
-- they are not here yet, and the plan requires each to be measured before and
-- after it is added.

-- ── events ────────────────────────────────────────────────────────────────────
-- Q1 (`project_id` + time range, ORDER BY timestamp DESC LIMIT 51) is the
-- dominant read and the sort key serves it directly. The alternative that put
-- `level` ahead of `timestamp` lost every variant, including the level-filtered
-- one it existed for, by 23×: a LIMIT over a DESC sort cannot terminate early
-- when the sort key does not lead on time, so the whole range is read and
-- sorted regardless of what `level` prunes. See §14.1.
CREATE TABLE IF NOT EXISTS events
(
    project_id      UUID,
    timestamp       DateTime64(3, 'UTC') CODEC(Delta, ZSTD(1)),
    -- UUIDv7, minted by the ingest path. v4 measured at compression ratio 1.0
    -- and a fifth of the whole table (§14.2); v7's leading timestamp bits are
    -- near-constant within a granule, so ZSTD has something to work with.
    id              UUID,

    -- Enum8, not a string: one byte, validated at insert, and *ordered*, so
    -- `level >= 'error'` works natively.
    level           Enum8('debug' = 1, 'info' = 2, 'warn' = 3, 'error' = 4, 'fatal' = 5),
    message         String CODEC(ZSTD(3)),
    -- Backs the tokenbf_v1 index below. Postgres used
    -- to_tsvector('simple', message), which lowercases and splits on non-word
    -- characters and does no stemming — close enough to the token filter's
    -- tokenizer for parity.
    message_lower   String MATERIALIZED lowerUTF8(message) CODEC(ZSTD(3)),

    source          LowCardinality(String),
    environment     LowCardinality(String),
    release         LowCardinality(String),
    error_type      LowCardinality(String),

    user_id         String CODEC(ZSTD(1)),
    session_id      String CODEC(ZSTD(1)),
    -- The largest column in the table at 24% (§14.2): a 36-character string
    -- holding a value that is unique per row, so it barely compresses.
    -- `trace_id` holds the same kind of value and compresses 14× because eight
    -- events share one. Storing it as UUID when it parses as one is open and
    -- can be done later — a column is cheap to add or retype.
    request_id      String CODEC(ZSTD(1)),
    trace_id        String CODEC(ZSTD(1)),

    template_hash   UInt64,
    -- The template text itself, written by the same ingest pass that computes
    -- the hash beside it.
    --
    -- **Stored per row rather than in a lookup table, decided in Phase 4.**
    -- Postgres kept it in `message_templates` and joined; that table, its
    -- registry service and the second normalisation it performed are gone. The
    -- alternative here was to group by `template_hash` and display `any(message)`
    -- — an arbitrary concrete instance, so a group of ten thousand would be
    -- labelled "user u_487 signed in" and read as one event.
    --
    -- The duplication is real and small, and it was measured rather than
    -- assumed (§12.4, 300k generated events): **2.00 bytes/row at 13x
    -- compression, 4.4% of the table**, against `message` at 4.85 bytes/row and
    -- 5.8x. The ratio is the whole reason it is cheap — 2,252 distinct
    -- templates against 110,112 distinct messages in that corpus, and the sort
    -- key puts near-identical values in one granule.
    --
    -- What transfers to a real install is the ratio, not the byte count: the
    -- measured install-wide figure is 18,080 distinct templates (§6.3), and the
    -- generator's message mix is its own.
    message_template String CODEC(ZSTD(3)),

    -- The JSON type, not three Maps. A Map is two parallel arrays, so reading
    -- one key reads every key in the granule; a JSON path is its own subcolumn.
    -- Measured at 18 keys/project: 16× less read and 12× faster, and JSON's
    -- cost did not move when the key count grew six-fold while the Map's
    -- tripled (§14.3).
    --
    -- The named ceiling (§14.3.2): memory per *path* — the sum of distinct
    -- attribute key names across all projects — is the binding limit, and it
    -- bites around 180 paths, an order of magnitude before `max_dynamic_paths`.
    -- Width is nearly free; path count is not. Treat the install-wide distinct
    -- key count as a monitored quantity with an alarm well below 1,000.
    --
    -- Do not ask ClickHouse what paths exist: JSONAllPaths() materialises every
    -- path for every row and failed from 360 paths up. `attribute_key_types` in
    -- Postgres is the catalogue; this column is storage.
    attributes      JSON(max_dynamic_paths = 2048),

    -- Displayed, never filtered. The best-practice rule for an opaque JSON blob
    -- with no field-level queries is String.
    context         String CODEC(ZSTD(3)),
    stack_trace     String CODEC(ZSTD(3)),

    -- Deliberately not LowCardinality: browser traffic blows past the 10k
    -- threshold where it degrades. ZSTD captures the repetition anyway.
    -- Revisit once `uniq(user_agent)` can be measured on real traffic
    -- (experiment 4, still unanswered).
    user_agent      String CODEC(ZSTD(3)),
    -- 16 fixed bytes against a 7-39 byte string; v4 is stored v4-mapped.
    ip              IPv6,

    -- Written at insert from the project's setting so the row TTL is a plain
    -- function of table columns — no dictionary lookup inside a TTL. Wired up
    -- in Phase 6; the TTL clause is not on the table yet.
    retention_days  UInt16 DEFAULT 30,

    -- Full-text search (§5). Postgres had no index on the four correlation ids
    -- at all, so those bloom filters are a straight improvement.
    INDEX idx_msg     message_lower TYPE tokenbf_v1(32768, 3, 0) GRANULARITY 4,
    INDEX idx_trace   trace_id      TYPE bloom_filter(0.01)      GRANULARITY 4,
    INDEX idx_request request_id    TYPE bloom_filter(0.01)      GRANULARITY 4,
    INDEX idx_session session_id    TYPE bloom_filter(0.01)      GRANULARITY 4,
    INDEX idx_user    user_id       TYPE bloom_filter(0.01)      GRANULARITY 4,
    INDEX idx_errtype error_type    TYPE bloom_filter(0.01)      GRANULARITY 4,
    INDEX idx_tmpl    template_hash TYPE bloom_filter(0.01)      GRANULARITY 4

    -- No index on level/source/environment/release: they are Enum8 or
    -- LowCardinality and appear in every granule, so a set index skips nothing.
)
ENGINE = MergeTree
-- Monthly, not daily. Daily partitioning of a log table is a named
-- anti-pattern — 365 partitions a year, growing without bound. Retention is a
-- TTL (Phase 6), not DROP PARTITION, because per-project retention makes
-- partitions non-homogeneous anyway.
PARTITION BY toYYYYMM(timestamp)
-- Shorter than ORDER BY on purpose: the sparse index is held in memory and a
-- random UUID contributes nothing to granule pruning.
PRIMARY KEY (project_id, timestamp)
-- `id` is here solely to make Q1's keyset pagination deterministic.
ORDER BY (project_id, timestamp, id)
SETTINGS
    index_granularity = 8192,
    -- Without this the table deduplicates *nothing* and
    -- `insert_deduplication_token` is accepted and ignored — deduplication is
    -- a Replicated* feature unless a non-replicated table opts in, and the
    -- default is 0. Measured 2026-08-26 (§14.8): a plain MergeTree stored an
    -- identical retry twice while reporting success both times.
    --
    -- It is a count of the last N inserts **per partition**, with no time
    -- dimension — the `_seconds` and `_for_async_inserts` variants exist only
    -- for Replicated tables. So the size is a *rate* decision: it has to
    -- outlast the gap between an insert and an SDK's retry of it. 10,000 is
    -- ~86 seconds at the 10M events/day target if every event arrives on its
    -- own, and hours at 500 per batch.
    --
    -- The size is close to free: the log measured **60 bytes an entry**
    -- (18,011 bytes for 300), so this is ~600 KB, and insert throughput was
    -- identical at 100, 1,000 and 10,000. The number matches ClickHouse's own
    -- default for the replicated async-insert window.
    non_replicated_deduplication_window = 10000;

-- `CREATE TABLE IF NOT EXISTS` above does nothing to a table that already
-- exists, so anything added to it after the first deploy has to be applied
-- separately. Both statements below are idempotent and both are metadata only.
ALTER TABLE events MODIFY SETTING non_replicated_deduplication_window = 10000;
-- Added in Phase 4. Existing rows read it as `''`, which is the correct answer
-- for them: they were written before the column existed and no query can
-- reconstruct a template from SQL.
ALTER TABLE events ADD COLUMN IF NOT EXISTS message_template String CODEC(ZSTD(3)) AFTER template_hash;
