CREATE EXTENSION IF NOT EXISTS pg_partman;

-- Query-level statistics. Requires `shared_preload_libraries=pg_stat_statements`,
-- which both compose files pass on the postgres command line.
--
-- The app's own slow-query logger (core/db/middleware/slow-query-logger.ts)
-- only reports queries over 500 ms, so it cannot see an 80 ms query called two
-- hundred times a minute — which is what the read path actually looks like.
-- This fills that gap.
--
-- NOTE: this file runs only against the container's default database (POSTGRES_DB)
-- and only on an empty data directory. An existing install needs it once by hand:
--   docker compose exec postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
--     -c 'CREATE EXTENSION IF NOT EXISTS pg_stat_statements'
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
