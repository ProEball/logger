export async function register(): Promise<void> {
    if (process.env.NEXT_RUNTIME !== "nodejs") return;

    if (process.env.WORKER_IN_PROCESS === "true") {
        const { startWorker } = await import("@/core/worker/worker");
        await startWorker();
    }
}
