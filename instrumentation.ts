export async function register(): Promise<void> {
    if (process.env.NEXT_RUNTIME !== "nodejs") return;

    // Imported lazily: `@/core/env` validates the full server schema on import,
    // which must not run in the edge runtime bailed out of above.
    const { env } = await import("@/core/env");

    if (env.WORKER_IN_PROCESS) {
        const { startWorker } = await import("@/core/worker/worker");
        await startWorker();
    }
}
