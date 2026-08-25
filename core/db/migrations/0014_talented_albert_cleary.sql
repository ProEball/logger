-- Hand-extended after generation, the same way 0008 and 0013 were. What
-- drizzle-kit emitted was three statements in an order that cannot run: it
-- swapped the primary key to include `environment` *before* adding the column,
-- and added it `NOT NULL` with no default, which fails outright on a non-empty
-- table.
--
-- `environment` joins the key of `event_rollup_minutes` so that a filtered read
-- stops falling back to raw `events`. Measured 2026-08-25 on 500k events, that
-- fallback cost `projectStats` 4.47 ms → 17.20 and `levelBreakdown` 7.16 →
-- 15.36, and it was why the error-ratio chart could not be filtered at all.
--
-- **Existing rows mix every environment together**, because that is precisely
-- what `(project, minute)` meant. They cannot be split here: re-deriving them
-- would read the whole events table and make deploy time proportional to data
-- volume, which 0008 and 0013 both refused for the same reason. So they are
-- stamped `'(all)'` — a sentinel no client can produce, since ingest never
-- writes a name in parentheses.
--
-- Summing across `(all)` stays exact: it is still one minute's complete total.
-- Only a *filtered* read must avoid it, and `envRollupFloor` is what makes it
-- do so — the newest `(all)` minute in scope, against which a filtered read
-- decides whether the rollup can answer. Same shape as the `by_source` floor
-- 0013 introduced, and for the same reason.
ALTER TABLE "event_rollup_minutes" ADD COLUMN "environment" text NOT NULL DEFAULT '(all)';--> statement-breakpoint
ALTER TABLE "event_rollup_minutes" DROP CONSTRAINT "event_rollup_minutes_project_id_minute_pk";--> statement-breakpoint
ALTER TABLE "event_rollup_minutes" ADD CONSTRAINT "event_rollup_minutes_project_id_minute_environment_pk" PRIMARY KEY("project_id","minute","environment");--> statement-breakpoint
-- The default existed only to stamp the rows above. Every row written from here
-- states its environment, and a row that forgot to should fail loudly.
ALTER TABLE "event_rollup_minutes" ALTER COLUMN "environment" DROP DEFAULT;--> statement-breakpoint
-- Supports the floor check, which asks "is there an (all) row in this range".
-- Partial on purpose: the rows it looks for are a shrinking minority that
-- reaches zero as the rebuild advances, and a full index would keep paying for
-- itself long after the answer became "no" for every project.
CREATE INDEX "event_rollup_minutes_pre_env_idx" ON "event_rollup_minutes" USING btree ("project_id","minute") WHERE "environment" = '(all)';--> statement-breakpoint
-- Pulling `refresh_from` back to each project's oldest event is what replaces
-- the stamped rows with real per-environment ones. The job covers one day per
-- run, once a minute, so a 30-day history refills in about half an hour of
-- background work; the `(all)` rows disappear as it advances and the floor
-- moves with them.
--
-- `rolled_up_to` is deliberately NOT reset, exactly as in 0013. It governs
-- completeness, which is unaffected — an `(all)` row is a complete count of its
-- minute. Resetting it would send every dashboard on the install to raw
-- `events` for the whole rebuild window to fix something only filtered reads
-- care about.
--
-- Re-running this statement is harmless: `LEAST` cannot move a watermark
-- forward, so a repeated migration converges rather than accumulating.
UPDATE "rollup_state" rs
SET "refresh_from" = LEAST(
        rs."refresh_from",
        COALESCE((SELECT MIN(e."timestamp") FROM "events" e WHERE e."project_id" = rs."project_id"), rs."refresh_from")
    );
