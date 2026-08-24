ALTER TABLE "event_rollup_minutes" ADD COLUMN "by_source" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
-- Hand-extended after generation, the same way 0008 was.
--
-- Existing rows get `{}`, which the reader treats as "written before this
-- column existed" rather than "this minute had no sources" — every event has a
-- source or '(unknown)', so a rebuilt row always carries at least one key.
-- Until a row is rebuilt, `topSources` must not read it, or a 30-day chart
-- silently loses every source older than this migration.
--
-- Pulling `refresh_from` back to each project's oldest event is what gets them
-- rebuilt. The job then covers one day per run, once a minute, so a 30-day
-- history refills in about half an hour of background work.
--
-- `rolled_up_to` is deliberately NOT reset. It governs the *level* rollup,
-- which is complete and correct for these rows; resetting it would send every
-- dashboard on the install to raw `events` for the whole rebuild window to fix
-- a column none of those reads touch. `topSources` carries its own check
-- instead, so only it degrades, and only for ranges reaching into unrebuilt
-- history.
--
-- As in 0008, the aggregation itself is left to the background job: a migration
-- that reads the whole events table makes deploy time proportional to data
-- volume, and a failure halfway blocks the release instead of retrying.
UPDATE "rollup_state" rs
SET "refresh_from" = LEAST(
        rs."refresh_from",
        COALESCE((SELECT MIN(e."timestamp") FROM "events" e WHERE e."project_id" = rs."project_id"), rs."refresh_from")
    );
