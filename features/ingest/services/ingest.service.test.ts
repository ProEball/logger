import { describe, it, expect, vi, beforeEach } from "vitest";
import { events, projectEnvironments } from "@/core/db/schema";

/**
 * Only the database is mocked. `checkAttributeTypeConflicts` and
 * `recordEnvironments` are internal modules and run for real against the stub,
 * per PROJECT.md §11 — mocking them would test the mock, and the behaviour that
 * matters here is precisely how this service reacts when one of them fails.
 */

type InsertCall = { table: unknown; values: unknown };

const { insertMock, insertCalls, loggerErrorMock } = vi.hoisted(() => ({
    insertMock: vi.fn(),
    insertCalls: [] as InsertCall[],
    loggerErrorMock: vi.fn(),
}));

vi.mock("@/core/db/client", () => ({ db: { insert: insertMock } }));
vi.mock("@/core/logger", () => ({ logger: { error: loggerErrorMock, warn: vi.fn(), info: vi.fn() } }));

import { ingestSingle, ingestBatch } from "@/features/ingest/services/ingest.service";

/** A `.then`-able chain, matching the stub style in alert-rules.service.test.ts. */
function chain(result: unknown) {
    const c: Record<string, unknown> = {
        values: (values: unknown) => {
            insertCalls.push({ table: c.__table, values });
            return c;
        },
        onConflictDoUpdate: () => c,
        returning: () => c,
        then: (resolve: (v: unknown) => void) => resolve(result),
    };
    return c;
}

/** Insert behaviour per table; `undefined` means "succeed silently". */
let environmentInsertError: Error | null = null;
let eventInsertError: Error | null = null;

beforeEach(() => {
    vi.clearAllMocks();
    insertCalls.length = 0;
    environmentInsertError = null;
    eventInsertError = null;

    insertMock.mockImplementation((table: unknown) => {
        const c = chain([]) as Record<string, unknown>;
        c.__table = table;
        if (table === projectEnvironments) {
            c.then = (_res: unknown, rej: (e: unknown) => void) => {
                if (environmentInsertError) return rej(environmentInsertError);
                return (_res as (v: unknown) => void)([]);
            };
        }
        if (table === events) {
            c.then = (res: (v: unknown) => void, rej: (e: unknown) => void) => {
                if (eventInsertError) return rej(eventInsertError);
                return res([]);
            };
        }
        return c;
    });
});

const ctx = { userAgent: "vitest", ip: "127.0.0.1", projectId: "11111111-1111-4111-8111-111111111111" };

/**
 * A parsed ingest event. `attributes`/`context` are spelled out because the Zod
 * schema defaults them and this fixture bypasses Zod — the real
 * `checkAttributeTypeConflicts` iterates them and would see `undefined`.
 */
function event(patch: Record<string, unknown> = {}) {
    return { level: "info", message: "hello", attributes: {}, context: {}, ...patch } as never;
}

function insertsInto(table: unknown) {
    return insertCalls.filter((c) => c.table === table);
}

describe("ingestSingle", () => {
    it("inserts the event and returns its id", async () => {
        const result = await ingestSingle(event(), ctx);
        expect(result.id).toMatch(/^[0-9a-f-]{36}$/);
        expect(insertsInto(events)).toHaveLength(1);
    });

    it("records the event's environment in the registry", async () => {
        await ingestSingle(event({ environment: "production" }), ctx);
        expect(insertsInto(projectEnvironments)).toHaveLength(1);
    });

    it("records an absent environment too, since '(unset)' is a real filter option", async () => {
        await ingestSingle(event(), ctx);
        const [call] = insertsInto(projectEnvironments);
        expect(call.values).toEqual([{ projectId: ctx.projectId, environment: null }]);
    });

    it("still returns the event id when the registry write fails", async () => {
        // The events are already durable at this point. Failing the request
        // would lose the event to protect derived data — the wrong trade, and
        // the reason this is the one swallowed error on the ingest path.
        environmentInsertError = new Error("deadlock detected");

        const result = await ingestSingle(event({ environment: "production" }), ctx);

        expect(result.id).toMatch(/^[0-9a-f-]{36}$/);
        expect(loggerErrorMock).toHaveBeenCalled();
    });

    it("does not swallow a failure to insert the event itself", async () => {
        eventInsertError = new Error("connection terminated");
        await expect(ingestSingle(event(), ctx)).rejects.toThrow("connection terminated");
    });
});

describe("ingestBatch", () => {
    it("inserts every event in one statement and reports the count", async () => {
        const result = await ingestBatch([event(), event(), event()], ctx);

        expect(result).toEqual({ accepted: 3, errors: [] });
        expect(insertsInto(events)).toHaveLength(1);
        expect((insertsInto(events)[0].values as unknown[])).toHaveLength(3);
    });

    it("records each distinct environment once, not once per event", async () => {
        await ingestBatch(
            [
                event({ environment: "production" }),
                event({ environment: "production" }),
                event({ environment: "staging" }),
            ],
            ctx,
        );

        const [call] = insertsInto(projectEnvironments);
        expect(call.values).toHaveLength(2);
    });

    it("touches neither table for an empty batch", async () => {
        const result = await ingestBatch([], ctx);
        expect(result).toEqual({ accepted: 0, errors: [] });
        expect(insertCalls).toHaveLength(0);
    });

    it("still accepts the batch when the registry write fails", async () => {
        environmentInsertError = new Error("deadlock detected");

        const result = await ingestBatch([event({ environment: "production" })], ctx);

        expect(result.accepted).toBe(1);
        expect(result.errors).toEqual([]);
        expect(loggerErrorMock).toHaveBeenCalled();
    });

    it("logs the project id with a registry failure, so it can be traced", async () => {
        environmentInsertError = new Error("deadlock detected");
        await ingestBatch([event()], ctx);

        expect(loggerErrorMock).toHaveBeenCalledWith(
            expect.objectContaining({ projectId: ctx.projectId }),
            expect.stringContaining("environment registry"),
        );
    });
});
