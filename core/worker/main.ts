/**
 * Entrypoint for the standalone worker container.
 *
 * Bundled to `worker.js` by `scripts/build-worker.mjs` and run as
 * `node worker.js` — see `Dockerfile`. The in-process path used during dev
 * (`WORKER_IN_PROCESS=true` → `instrumentation.ts`) shares `startWorker()` with
 * this file, so a job registered once is picked up by both.
 */
import { logger } from "@/core/logger";
import { startHealthTouch } from "@/core/worker/health-touch";
import { createShutdownHandler } from "@/core/worker/shutdown";
import { startWorker, stopWorker } from "@/core/worker/worker";

async function main(): Promise<void> {
    const health = startHealthTouch();

    const onSignal = createShutdownHandler({
        shutdown: async () => {
            health.stop();
            await stopWorker();
        },
        exit: (code) => process.exit(code),
    });

    process.on("SIGTERM", (signal) => void onSignal(signal));
    process.on("SIGINT", (signal) => void onSignal(signal));

    // pg-boss surfaces connection failures through the "error" event that
    // `startWorker` subscribes to, but a throw from a job handler that escapes
    // its own catch would otherwise kill the process with no log line at all.
    process.on("unhandledRejection", (reason) => {
        logger.error({ err: reason }, "unhandled rejection in worker");
    });

    await startWorker();
    logger.info("worker ready");
}

main().catch((err) => {
    logger.fatal({ err }, "worker failed to start");
    process.exit(1);
});
