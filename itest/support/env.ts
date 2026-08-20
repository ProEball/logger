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
