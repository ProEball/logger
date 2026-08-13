import { describe, it, expect, vi } from "vitest";
import { createShutdownHandler } from "./shutdown";

describe("createShutdownHandler", () => {
    it("drains, then exits 0", async () => {
        const shutdown = vi.fn().mockResolvedValue(undefined);
        const exit = vi.fn();

        await createShutdownHandler({ shutdown, exit })("SIGTERM");

        expect(shutdown).toHaveBeenCalledTimes(1);
        expect(exit).toHaveBeenCalledWith(0);
    });

    it("exits non-zero when draining throws, rather than hanging until SIGKILL", async () => {
        const shutdown = vi.fn().mockRejectedValue(new Error("pg-boss wedged"));
        const exit = vi.fn();

        await createShutdownHandler({ shutdown, exit })("SIGTERM");

        expect(exit).toHaveBeenCalledWith(1);
    });

    it("ignores a second signal that arrives mid-drain", async () => {
        // `docker compose down` then an impatient Ctrl-C: without the guard the
        // second signal would call boss.stop() on an already-stopping instance.
        let releaseFirstDrain: () => void = () => {};
        const shutdown = vi.fn(
            () =>
                new Promise<void>((resolve) => {
                    releaseFirstDrain = resolve;
                }),
        );
        const exit = vi.fn();
        const handler = createShutdownHandler({ shutdown, exit });

        const first = handler("SIGTERM");
        await handler("SIGINT");

        expect(shutdown).toHaveBeenCalledTimes(1);
        expect(exit).not.toHaveBeenCalled();

        releaseFirstDrain();
        await first;

        expect(exit).toHaveBeenCalledTimes(1);
        expect(exit).toHaveBeenCalledWith(0);
    });

    it("ignores a repeat signal after the drain already finished", async () => {
        const shutdown = vi.fn().mockResolvedValue(undefined);
        const exit = vi.fn();
        const handler = createShutdownHandler({ shutdown, exit });

        await handler("SIGTERM");
        await handler("SIGTERM");

        expect(shutdown).toHaveBeenCalledTimes(1);
        expect(exit).toHaveBeenCalledTimes(1);
    });
});
