import type { PgBoss } from "pg-boss";
import { db } from "@/core/db/client";
import { sql } from "drizzle-orm";

export const PARTMAN_JOB_NAME = "partman-maintenance";

/**
 * Registers the hourly partman maintenance schedule with pg-boss.
 * Uses singletonKey to prevent double-execution on rolling restarts.
 * pg_partman is installed in the public schema.
 */
export async function registerPartmanMaintenanceJob(boss: PgBoss): Promise<void> {
    await boss.schedule(
        PARTMAN_JOB_NAME,
        "0 * * * *", // every hour
        {},
        {
            singletonKey: PARTMAN_JOB_NAME,
        },
    );

    await boss.work(PARTMAN_JOB_NAME, async () => {
        await db.execute(sql`SELECT public.run_maintenance(p_analyze := false)`);
    });
}
