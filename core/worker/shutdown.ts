import { logger } from "@/core/logger";

export type ShutdownDeps = {
    /** Releases resources. Expected to resolve once draining is complete. */
    shutdown: () => Promise<void>;
    /** Injected so the handler stays testable; production passes `process.exit`. */
    exit: (code: number) => void;
};

/**
 * Builds the signal handler the worker installs for SIGTERM/SIGINT.
 *
 * Docker sends SIGTERM and then SIGKILLs after `stop_grace_period`. Two things
 * have to hold for that to be a clean stop rather than a job left half-done:
 *
 * - **Re-entrancy.** `docker compose down` followed by an impatient Ctrl-C
 *   delivers a second signal while the first drain is still running. Re-running
 *   the shutdown would call `boss.stop()` on an already-stopping instance; the
 *   second signal is logged and ignored instead.
 * - **Failure is still an exit.** If draining throws we exit non-zero rather
 *   than hanging until SIGKILL, so `restart: unless-stopped` can restart us and
 *   the failure shows up in `docker ps` instead of looking like a clean stop.
 */
export function createShutdownHandler({
    shutdown,
    exit,
}: ShutdownDeps): (signal: string) => Promise<void> {
    let isShuttingDown = false;

    return async (signal: string) => {
        if (isShuttingDown) {
            logger.warn({ signal }, "worker shutdown already in progress — ignoring signal");
            return;
        }
        isShuttingDown = true;

        logger.info({ signal }, "worker shutting down");

        try {
            await shutdown();
            logger.info({ signal }, "worker shutdown complete");
            exit(0);
        } catch (err) {
            logger.error({ err, signal }, "worker shutdown failed");
            exit(1);
        }
    };
}
