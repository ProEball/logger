import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type postgres from "postgres";
import { wrapWithSlowQueryLogger } from "./slow-query-logger";

type PgSql = ReturnType<typeof postgres>;

const mockWarn = vi.hoisted(() => vi.fn());
vi.mock("@/core/logger", () => ({ logger: { warn: mockWarn, error: vi.fn() } }));

/**
 * Stands in for the postgres.js client, which is callable as a tagged template
 * and carries extra properties. Only the call path is exercised here.
 */
function fakeClient(behaviour: () => Promise<unknown>): PgSql {
    const client = (() => behaviour()) as unknown as PgSql;
    (client as unknown as { options: unknown }).options = { host: "test" };
    return client;
}

const SQL = Object.assign(["SELECT 1 FROM ", ""], {
    raw: ["SELECT 1 FROM ", ""],
}) as unknown as TemplateStringsArray;

beforeEach(() => {
    vi.clearAllMocks();
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe("wrapWithSlowQueryLogger", () => {
    it("passes the result through untouched", async () => {
        const rows = [{ id: 1 }];
        const wrapped = wrapWithSlowQueryLogger(fakeClient(async () => rows));

        await expect((wrapped as unknown as (...a: unknown[]) => Promise<unknown>)(SQL, "t")).resolves.toBe(rows);
    });

    it("does not warn about a fast query", async () => {
        const wrapped = wrapWithSlowQueryLogger(fakeClient(async () => []));

        await (wrapped as unknown as (...a: unknown[]) => Promise<unknown>)(SQL, "t");

        expect(mockWarn).not.toHaveBeenCalled();
    });

    it("warns once a query crosses the slow threshold", async () => {
        const wrapped = wrapWithSlowQueryLogger(
            fakeClient(() => new Promise((resolve) => setTimeout(() => resolve([]), 520))),
        );

        await (wrapped as unknown as (...a: unknown[]) => Promise<unknown>)(SQL, "t");

        expect(mockWarn).toHaveBeenCalledTimes(1);
        expect(mockWarn.mock.calls[0][1]).toBe("slow query");
        expect(mockWarn.mock.calls[0][0].duration_ms).toBeGreaterThanOrEqual(500);
    });

    it("still rejects to the caller when the query fails", async () => {
        const boom = new Error('relation "nope" does not exist');
        const wrapped = wrapWithSlowQueryLogger(fakeClient(() => Promise.reject(boom)));

        await expect(
            (wrapped as unknown as (...a: unknown[]) => Promise<unknown>)(SQL, "t"),
        ).rejects.toBe(boom);
    });

    it("does not raise an unhandled rejection when the query fails", async () => {
        // The timing branch used to be `void Promise.resolve(result).then(...)`
        // with no rejection handler, which forks a second promise that nobody
        // owns. Every failed query therefore produced an unhandledRejection on
        // top of the caller's own error handling — including inside
        // /api/health/ready, whose try/catch made it look handled. Next traps
        // the event today; bare Node would terminate the process.
        const unhandled = vi.fn();
        process.on("unhandledRejection", unhandled);

        try {
            const wrapped = wrapWithSlowQueryLogger(
                fakeClient(() => Promise.reject(new Error("query failed"))),
            );

            await expect(
                (wrapped as unknown as (...a: unknown[]) => Promise<unknown>)(SQL, "t"),
            ).rejects.toThrow("query failed");

            // unhandledRejection fires after the microtask queue drains, so the
            // assertion has to wait for at least one macrotask turn.
            await new Promise((resolve) => setTimeout(resolve, 20));

            expect(unhandled).not.toHaveBeenCalled();
        } finally {
            process.off("unhandledRejection", unhandled);
        }
    });

    it("does not warn about a query that failed fast", async () => {
        const wrapped = wrapWithSlowQueryLogger(
            fakeClient(() => Promise.reject(new Error("query failed"))),
        );

        await expect(
            (wrapped as unknown as (...a: unknown[]) => Promise<unknown>)(SQL, "t"),
        ).rejects.toThrow();
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(mockWarn).not.toHaveBeenCalled();
    });
});
