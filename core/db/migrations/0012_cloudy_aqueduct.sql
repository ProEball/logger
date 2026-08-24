-- Generated, then hand-edited into a single ALTER.
--
-- drizzle-kit emits one `ADD COLUMN ... GENERATED ... STORED` per column, and
-- every one of those rewrites the whole table — five rewrites of
-- `event_template_rollup` where one would do. Postgres applies multiple
-- ADD COLUMNs in a single ALTER as one rewrite, which is what this is.
--
-- The table is ~385 MB per month of retention, so the difference is minutes of
-- exclusive lock, not seconds. Deliberately still a rewrite rather than an
-- online change: STORED generated columns have to be materialised, there is no
-- cheaper form of this, and it happens once.
ALTER TABLE "event_template_rollup"
    ADD COLUMN "n_debug" integer GENERATED ALWAYS AS (COALESCE((by_level->>'debug')::int, 0)) STORED,
    ADD COLUMN "n_info"  integer GENERATED ALWAYS AS (COALESCE((by_level->>'info')::int,  0)) STORED,
    ADD COLUMN "n_warn"  integer GENERATED ALWAYS AS (COALESCE((by_level->>'warn')::int,  0)) STORED,
    ADD COLUMN "n_error" integer GENERATED ALWAYS AS (COALESCE((by_level->>'error')::int, 0)) STORED,
    ADD COLUMN "n_fatal" integer GENERATED ALWAYS AS (COALESCE((by_level->>'fatal')::int, 0)) STORED;
