import { closeSync, openSync, utimesSync } from "node:fs";
import { logger } from "@/core/logger";

/** Where the worker container's healthcheck looks for proof of life. */
export const DEFAULT_HEALTH_FILE = "/tmp/worker-alive";

/** Half the compose healthcheck window, so one missed touch is not a failure. */
export const DEFAULT_TOUCH_INTERVAL_MS = 30_000;

export type HealthTouch = {
    /** Stops the interval. Safe to call more than once. */
    stop: () => void;
};

/**
 * Keeps a file's mtime advancing while this process is alive.
 *
 * The worker has no HTTP surface to probe, so liveness is expressed as "a file
 * this process owns was touched recently". The Docker healthcheck asserts the
 * mtime is within the last minute; if the Node process dies or wedges, the file
 * goes stale and the container is marked unhealthy. The touch deliberately
 * lives in the worker process itself rather than in the entrypoint shell — a
 * shell loop would keep reporting healthy after Node had already died.
 *
 * A failed touch is logged and swallowed: a full /tmp should degrade the health
 * signal, not take down a worker that is otherwise draining jobs correctly.
 */
export function startHealthTouch(
    filePath: string = DEFAULT_HEALTH_FILE,
    intervalMs: number = DEFAULT_TOUCH_INTERVAL_MS,
): HealthTouch {
    touch(filePath);

    const timer = setInterval(() => touch(filePath), intervalMs);
    // Without this the interval alone would hold the event loop open forever
    // and a graceful shutdown would hang instead of exiting.
    timer.unref();

    let isStopped = false;
    return {
        stop: () => {
            if (isStopped) return;
            isStopped = true;
            clearInterval(timer);
        },
    };
}

function touch(filePath: string): void {
    try {
        // `utimesSync` throws if the file does not exist yet, so the first call
        // has to create it. "a" leaves any existing content alone.
        closeSync(openSync(filePath, "a"));
        const now = new Date();
        utimesSync(filePath, now, now);
    } catch (err) {
        logger.error({ err, filePath }, "worker health-touch failed");
    }
}
