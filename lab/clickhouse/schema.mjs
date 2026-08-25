/**
 * DDL for the Phase 0 candidates.
 *
 * **One template, two tables.** The whole point of the lab is to compare two
 * `ORDER BY` choices, and a comparison is only valid if nothing else differs.
 * Two hand-written `CREATE TABLE` statements would drift the first time one is
 * edited — a stray codec or a missing skip index would show up as a property of
 * the sort key. So the sort key is the only parameter.
 */

/** The candidates from `docs/features/09-clickhouse.md` §3.2. */
export const CANDIDATES = {
    /** Recommended: simple, matches Q1 (the dominant pattern) exactly. */
    events_a: {
        primaryKey: "(project_id, timestamp)",
        orderBy: "(project_id, timestamp, id)",
        note: "plan §3.2 recommendation",
    },
    /**
     * The alternative worth disproving rather than dismissing: a coarse time
     * bucket then `level`, which prunes level-filtered lists at the cost of
     * time locality for the unfiltered one.
     */
    events_b: {
        primaryKey: "(project_id, toStartOfHour(timestamp), level)",
        orderBy: "(project_id, toStartOfHour(timestamp), level, timestamp, id)",
        note: "level in the key",
    },
};

/**
 * `attributes` appears **twice**, as `JSON` and as two `Map`s.
 *
 * That is not the shipping schema — it is experiment 2. The plan proposes the
 * JSON type and names the three-Map design as the fallback if it misbehaves;
 * carrying both lets one query measure the difference on identical data
 * instead of on two corpora loaded a day apart.
 */
export function createTable(name) {
    const { primaryKey, orderBy } = CANDIDATES[name];
    return `
CREATE TABLE IF NOT EXISTS ${name}
(
    project_id      UUID,
    timestamp       DateTime64(3, 'UTC') CODEC(Delta, ZSTD(1)),
    id              UUID,

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

    attributes      JSON(max_dynamic_paths = 2048),
    attr_str        Map(LowCardinality(String), String),
    attr_num        Map(LowCardinality(String), Float64),

    context         String CODEC(ZSTD(3)),
    stack_trace     String CODEC(ZSTD(3)),

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
PRIMARY KEY ${primaryKey}
ORDER BY    ${orderBy}
SETTINGS index_granularity = 8192`.trim();
}

/**
 * The tier-1 projection from §6.2.
 *
 * Added **after** the corpus is loaded and measured without it, so the
 * before/after is a real measurement rather than an assumption. Applied to one
 * table at a time by `measure.mjs --projection`.
 */
export function addProjection(name) {
    return `
ALTER TABLE ${name} ADD PROJECTION IF NOT EXISTS p_minute (
    SELECT project_id, toStartOfMinute(timestamp) AS minute,
           level, environment, source,
           count()
    GROUP BY project_id, minute, level, environment, source
)`.trim();
}

export function materializeProjection(name) {
    return `ALTER TABLE ${name} MATERIALIZE PROJECTION p_minute`;
}
