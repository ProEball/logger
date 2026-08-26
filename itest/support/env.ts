/**
 * Connection settings for the integration-test database.
 *
 * `logger_itest` is a third database, separate from both `logger` (dev) and
 * `logger_test` (e2e). It is not shared with e2e on purpose: `resetDb()` in
 * `e2e/support/cleanup.ts` does `DELETE FROM events`, so a corpus seeded into
 * `logger_test` would be destroyed by the next `npm run test:e2e`.
 *
 * Defaults match `docker-compose.dev.yml`, so the usual local setup needs no
 * configuration at all. Override with `ITEST_DATABASE_URL` when Postgres lives
 * somewhere else (CI, a non-default port).
 */

export const ITEST_DB_NAME = "logger_itest";

/** Admin connection, used only to CREATE DATABASE if it is missing. */
export const ITEST_ADMIN_URL =
    process.env.ITEST_ADMIN_URL ?? "postgresql://postgres:postgres@localhost:5432/postgres";

export const ITEST_DATABASE_URL =
    process.env.ITEST_DATABASE_URL ??
    `postgresql://postgres:postgres@localhost:5432/${ITEST_DB_NAME}`;

/**
 * ClickHouse for the integration suite.
 *
 * A separate **database** on the dev container rather than a separate
 * container: ClickHouse databases are cheap and fully isolated for DDL and
 * data, and `docker-compose.dev.yml` already publishes 8123. `logger_itest`
 * keeps the suite's writes out of `logger`, which is the database a developer
 * is looking at.
 *
 * `test:it` needing ClickHouse up as well as Postgres is what
 * docs/features/09-clickhouse.md §11 predicted: with no Drizzle dialect, the
 * whole events path is raw SQL, and by PROJECT.md §11's own rule that makes it
 * integration-tested.
 */
export const ITEST_CH_DATABASE = process.env.ITEST_CLICKHOUSE_DATABASE ?? "logger_itest";
export const ITEST_CH_URL = process.env.ITEST_CLICKHOUSE_URL ?? "http://localhost:8123";
export const ITEST_CH_USER = process.env.ITEST_CLICKHOUSE_USER ?? "logger";
export const ITEST_CH_PASSWORD = process.env.ITEST_CLICKHOUSE_PASSWORD ?? "logger";
