import { PgBoss } from "pg-boss";
import { env } from "@/core/env";
import { logger } from "@/core/logger";
import { registerAlertEvaluationJob } from "@/features/alerts/jobs/alert-evaluation.job";
import { registerAlertDeliveryJob } from "@/features/alerts/jobs/alert-delivery.job";

let boss: PgBoss | null = null;

export function getBoss(): PgBoss | null {
    return boss;
}

/**
 * Starts pg-boss and registers all background jobs.
 *
 * Two callers, one implementation: the Next.js instrumentation hook when
 * `WORKER_IN_PROCESS=true` (dev convenience), and `core/worker/main.ts` in the
 * standalone worker container (production). Every new background job is
 * registered here so both paths pick it up.
 */
export async function startWorker(): Promise<void> {
    if (boss) return; // already started

    boss = new PgBoss(env.DATABASE_URL);
    boss.on("error", (err) => logger.error({ err }, "pg-boss error"));

    await boss.start();
    await registerAlertEvaluationJob(boss);
    await registerAlertDeliveryJob(boss);

    logger.info("pg-boss started, jobs registered");
}

/**
 * Upper bound on draining in-flight jobs. Must stay below the compose
 * `stop_grace_period` (30s) or Docker SIGKILLs us mid-drain.
 */
const SHUTDOWN_TIMEOUT_MS = 20_000;

/**
 * Stops pg-boss, letting in-flight job handlers finish first.
 *
 * The singleton is cleared even when `stop()` throws — otherwise a failed
 * shutdown would leave `startWorker` believing a dead boss is still running.
 */
export async function stopWorker(): Promise<void> {
    if (!boss) return;

    const running = boss;
    boss = null;

    try {
        await running.stop({ graceful: true, close: true, timeout: SHUTDOWN_TIMEOUT_MS });
        logger.info("pg-boss stopped");
    } catch (err) {
        logger.error({ err }, "pg-boss failed to stop cleanly");
    }
}
