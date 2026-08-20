// test-exempt: registration only. The work it schedules is `runRollupCycle`,
// covered against a real database in event-rollup.service.itest.ts; a test here
// could only assert that pg-boss was called, by mocking the service this file
// exists to call.
import type { PgBoss } from "pg-boss";
import { logger } from "@/core/logger";
import { runRollupCycle } from "@/features/ingest/services/event-rollup.service";

export const EVENT_ROLLUP_JOB_NAME = "event-rollup";

/**
 * Rebuilds `event_rollup_minutes` once a minute.
 *
 * Every minute rather than on demand, and that is the point rather than a
 * consequence: the dashboards then read a **snapshot** for everything below
 * `rolled_up_to`, so two people looking at the same page agree on it. Before
 * this, each aggregated over their own `now()` and every figure could differ.
 *
 * Agreement stops at the boundary — the raw tail above it is still computed per
 * request, so the newest minute can differ between two viewers. Accepted
 * deliberately: a chart permanently missing its newest minute would be worse.
 *
 * One minute is also the finest bucket the UI draws, so a run closes exactly
 * one bucket. A shorter cadence would only produce a half-filled current
 * minute that changes under the reader — and pg-boss cron has no finer
 * granularity anyway.
 *
 * Runs whether or not anyone is looking. That is the trade against caching:
 * cost follows the schedule, not the number of viewers nor the ingest rate.
 */
export async function registerEventRollupJob(boss: PgBoss): Promise<void> {
    // pg-boss 12 does not create queues implicitly; idempotent, so it is safe on
    // every worker start. Same reasoning as partman-maintenance.job.ts.
    await boss.createQueue(EVENT_ROLLUP_JOB_NAME);

    await boss.schedule(
        EVENT_ROLLUP_JOB_NAME,
        "* * * * *",
        {},
        {
            // A run that overruns its minute must not have a second started on
            // top of it: two rebuilds of the same window would fight over the
            // same rows.
            singletonKey: EVENT_ROLLUP_JOB_NAME,
        },
    );

    await boss.work(EVENT_ROLLUP_JOB_NAME, async () => {
        try {
            const result = await runRollupCycle();
            if (result.stillBehind > 0) {
                // Expected right after the migration, when the watermark starts
                // at the oldest event and catch-up is capped per run. Logged so
                // a backfill that never finishes is visible rather than silent.
                logger.info(result, "event rollup rebuilt; some projects still catching up");
            }
        } catch (err) {
            logger.error(
                {
                    err,
                    job: EVENT_ROLLUP_JOB_NAME,
                    hint: "dashboards will serve increasingly stale counts until this recovers",
                },
                "event rollup rebuild failed",
            );
        }
    });
}
