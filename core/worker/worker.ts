import { PgBoss } from "pg-boss";
import { registerPartmanMaintenanceJob } from "@/features/ingest/jobs/partman-maintenance.job";

let boss: PgBoss | null = null;

/**
 * Starts pg-boss and registers all background jobs.
 * Called once from the Next.js instrumentation hook when WORKER_IN_PROCESS=true.
 */
export async function startWorker(): Promise<void> {
    if (boss) return; // already started

    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        throw new Error("DATABASE_URL is required to start the worker.");
    }

    boss = new PgBoss(connectionString);
    boss.on("error", (err) => console.error("[worker] pg-boss error:", err));

    await boss.start();
    await registerPartmanMaintenanceJob(boss);

    console.log("[worker] pg-boss started, jobs registered.");
}
