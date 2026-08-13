import type { PgBoss } from "pg-boss";
import { evaluateAllEnabled } from "@/features/alerts/services/alert-evaluator.service";

export const ALERT_EVALUATION_JOB = "alert-evaluation";

export async function registerAlertEvaluationJob(boss: PgBoss): Promise<void> {
    // See registerPartmanMaintenanceJob — pg-boss 12 requires the queue to
    // exist before it can be scheduled or worked. Idempotent.
    await boss.createQueue(ALERT_EVALUATION_JOB);

    await boss.schedule(
        ALERT_EVALUATION_JOB,
        "* * * * *", // every minute
        {},
        {
            singletonKey: ALERT_EVALUATION_JOB,
        },
    );

    await boss.work(ALERT_EVALUATION_JOB, async () => {
        await evaluateAllEnabled(boss);
    });
}
