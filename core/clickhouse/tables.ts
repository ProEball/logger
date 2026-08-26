/**
 * ClickHouse table names, in one place.
 *
 * Three modules across two features name `events`: the ingest write path, the
 * events read path, and the alert evaluator's count. A constant in any one of
 * them would be a cross-feature import (`PROJECT.md` §2.1) for the other two,
 * so it lives here — the same reason `event-row.types.ts` does.
 *
 * Phase 5 adds `events_by_template` and `events_by_correlation`; this is where
 * they go.
 *
 * test-exempt: a table-name constant has no branch, boundary or rule to assert.
 * Its correctness is proved by the integration tests that query the table.
 */

export const EVENTS_TABLE = "events";
