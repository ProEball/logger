import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * `@clickhouse/client` is a real system boundary (an HTTP client), so mocking it
 * is what PROJECT.md §11 permits — the thing under test is the branch this
 * module puts around it, not the transport.
 */
// `vi.hoisted` because `vi.mock` is lifted above every other statement in the
// file; a plain `const ping = vi.fn()` is still in its temporal dead zone when
// the factory runs, and the module fails to load rather than failing a test.
const { ping } = vi.hoisted(() => ({ ping: vi.fn() }));

vi.mock("@clickhouse/client", () => ({
    createClient: () => ({ ping }),
}));

import { pingClickhouse, clickhouse } from "./client";

beforeEach(() => {
    ping.mockReset();
});

describe("pingClickhouse", () => {
    it("resolves when the server answers", async () => {
        ping.mockResolvedValue({ success: true });
        await expect(pingClickhouse()).resolves.toBeUndefined();
    });

    /**
     * The branch that makes the readiness probe capable of failing at all.
     * `ping()` **does not throw** — it reports failure in the result object —
     * so a bare `await clickhouse.ping()` is a healthcheck that always passes.
     */
    it("throws the error the client reports rather than swallowing it", async () => {
        const error = new Error("connect ECONNREFUSED 127.0.0.1:8123");
        ping.mockResolvedValue({ success: false, error });

        await expect(pingClickhouse()).rejects.toThrow("connect ECONNREFUSED 127.0.0.1:8123");
    });

    it("propagates a rejection from the client untouched", async () => {
        ping.mockRejectedValue(new Error("socket hang up"));
        await expect(pingClickhouse()).rejects.toThrow("socket hang up");
    });

    /**
     * `select: true` is load-bearing, not a style choice. The default `/ping`
     * endpoint does not verify credentials, so a wrong password or a missing
     * database would pass the probe and fail every real query. Asserting on the
     * argument is asserting on behaviour here: it is the difference between
     * "the process is listening" and "this app can query it".
     */
    it("asks the server to verify credentials, not just to answer", async () => {
        ping.mockResolvedValue({ success: true });
        await pingClickhouse();

        expect(ping).toHaveBeenCalledWith({ select: true });
    });
});

describe("the client singleton", () => {
    it("is built once and reused", async () => {
        const again = await import("./client");
        expect(again.clickhouse).toBe(clickhouse);
    });
});
