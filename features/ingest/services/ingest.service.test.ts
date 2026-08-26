import { describe, it, expect, vi, beforeEach } from "vitest";
import { attributeKeyTypes } from "@/core/db/schema";

/**
 * Only the two clients are mocked — both are real system boundaries, which is
 * the one thing PROJECT.md §11 allows. `checkAttributeTypeConflicts`,
 * `enrichEvent` and `toClickhouseRow` are internal modules and run for real
 * against the stubs: mocking them would test the mock, and the behaviour that
 * matters here is precisely how this service reacts when one of them fails.
 *
 * **Rewritten in Phase 4, and most of what it asserted is simply gone.** This
 * file used to cover a dual write and three derived Postgres tables — an
 * environment registry, a template registry and a rollup watermark — each with
 * a "the request still succeeds when this fails" test, because each failure was
 * deliberately swallowed. None of those tables exists. Postgres is still here
 * for one thing on this path (`attribute_key_types`, which *validates* rather
 * than summarises), and its failure is not swallowed.
 */

type InsertCall = { table: unknown; values: unknown };

const { insertMock, insertCalls, loggerErrorMock, chInsertMock } = vi.hoisted(() => ({
    insertMock: vi.fn(),
    insertCalls: [] as InsertCall[],
    loggerErrorMock: vi.fn(),
    chInsertMock: vi.fn(),
}));

vi.mock("@/core/db/client", () => ({ db: { insert: insertMock } }));
vi.mock("@/core/clickhouse/client", () => ({ clickhouse: { insert: chInsertMock } }));
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
        onConflictDoNothing: () => c,
        returning: () => c,
        then: (resolve: (v: unknown) => void) => resolve(result),
    };
    return c;
}

/** `null` means "succeed silently". */
let attributeTypeError: Error | null = null;
let clickhouseInsertError: Error | null = null;

beforeEach(() => {
    vi.clearAllMocks();
    insertCalls.length = 0;
    attributeTypeError = null;
    clickhouseInsertError = null;

    chInsertMock.mockImplementation(async () => {
        if (clickhouseInsertError) throw clickhouseInsertError;
        return { executed: true, query_id: "stub" };
    });

    insertMock.mockImplementation((table: unknown) => {
        const c = chain([]) as Record<string, unknown>;
        c.__table = table;
        if (table === attributeKeyTypes) {
            c.then = (res: (v: unknown) => void, rej: (e: unknown) => void) => {
                if (attributeTypeError) return rej(attributeTypeError);
                return res([]);
            };
        }
        return c;
    });
});

const ctx = {
    userAgent: "vitest",
    ip: "127.0.0.1",
    projectId: "11111111-1111-4111-8111-111111111111",
    dedupToken: null,
};

/** The rows handed to ClickHouse across every insert this test made. */
function clickhouseRows(): Array<Record<string, unknown>> {
    return chInsertMock.mock.calls.flatMap(
        (call) => (call[0] as { values: Array<Record<string, unknown>> }).values,
    );
}

/**
 * A parsed ingest event. `attributes`/`context` are spelled out because the Zod
 * schema defaults them and this fixture bypasses Zod — the real
 * `checkAttributeTypeConflicts` iterates them and would see `undefined`.
 */
function event(patch: Record<string, unknown> = {}) {
    return { level: "info", message: "hello", attributes: {}, context: {}, ...patch } as never;
}

describe("ingestSingle", () => {
    it("writes the event and returns its id", async () => {
        const result = await ingestSingle(event(), ctx);

        expect(result.id).toMatch(/^[0-9a-f-]{36}$/);
        expect(clickhouseRows()).toHaveLength(1);
        expect(clickhouseRows()[0].id).toBe(result.id);
    });

    it("writes to ClickHouse and nowhere else", async () => {
        // The assertion is about Phase 4 rather than about this request: the
        // Postgres `events` table is gone, and a service that still reached for
        // it would fail at the type level here but pass every behavioural test
        // in this file if it wrote to some other table instead.
        await ingestSingle(event(), ctx);

        expect(chInsertMock.mock.calls[0][0]).toMatchObject({
            table: "events",
            format: "JSONEachRow",
        });
        expect(insertCalls.map((call) => call.table)).toEqual([]);
    });

    it("does not swallow a ClickHouse failure", async () => {
        // There is one store now, so there is nothing to be partially written
        // and no reason to report success. Every error on this path propagates.
        clickhouseInsertError = new Error("too many parts");
        await expect(ingestSingle(event(), ctx)).rejects.toThrow("too many parts");
        expect(loggerErrorMock).not.toHaveBeenCalled();
    });

    it("does not swallow an attribute-type registry failure either", async () => {
        // That registry validates rather than summarises: it decides whether an
        // event is *accepted*, so a failure to consult it cannot be shrugged
        // off the way a lost rollup watermark could.
        attributeTypeError = new Error("connection terminated");
        await expect(ingestSingle(event({ attributes: { n: 1 } }), ctx)).rejects.toThrow(
            "connection terminated",
        );
        expect(chInsertMock).not.toHaveBeenCalled();
    });

    it("mints a UUIDv7, not a v4", async () => {
        const { id } = await ingestSingle(event(), ctx);
        expect(id.charAt(14)).toBe("7");
    });
});

describe("ingestBatch", () => {
    it("sends one insert for a whole batch and reports the count", async () => {
        const result = await ingestBatch([event(), event(), event()], ctx);

        expect(result).toEqual({ accepted: 3, errors: [] });
        expect(chInsertMock).toHaveBeenCalledTimes(1);
        expect(clickhouseRows()).toHaveLength(3);
    });

    it("writes nothing at all for an empty batch", async () => {
        const result = await ingestBatch([], ctx);

        expect(result).toEqual({ accepted: 0, errors: [] });
        expect(chInsertMock).not.toHaveBeenCalled();
        expect(insertCalls).toHaveLength(0);
    });

    it("does not swallow a ClickHouse failure for a batch", async () => {
        clickhouseInsertError = new Error("too many parts");
        await expect(ingestBatch([event()], ctx)).rejects.toThrow();
    });
});

/**
 * The row that reaches the wire.
 *
 * These assertions guard a failure that is invisible from the return value: an
 * event can be accepted, reported as stored, and be missing a field that only
 * the dashboards read.
 */
describe("the ClickHouse row", () => {
    it("passes the deduplication token when the request carried one", async () => {
        await ingestSingle(event(), { ...ctx, dedupToken: "proj:key-1" });

        expect(chInsertMock.mock.calls[0][0]).toMatchObject({
            clickhouse_settings: { insert_deduplication_token: "proj:key-1" },
        });
    });

    it("sends no token at all when the request carried none", async () => {
        // An empty string is not "no token" as far as ClickHouse is concerned,
        // and a token shared by every tokenless request would deduplicate
        // unrelated batches into nothing.
        await ingestSingle(event(), ctx);

        const settings = (chInsertMock.mock.calls[0][0] as { clickhouse_settings: object })
            .clickhouse_settings;
        expect(settings).not.toHaveProperty("insert_deduplication_token");
    });

    it("collapses an absent optional field to an empty string, never null", async () => {
        // The ClickHouse schema has no Nullable column anywhere — a null here
        // fails the insert rather than storing "unset".
        await ingestSingle(event(), ctx);
        const [row] = clickhouseRows();

        for (const column of ["source", "environment", "release", "error_type", "trace_id"]) {
            expect(row[column]).toBe("");
        }
    });

    it("carries the message template, which no query can reconstruct", async () => {
        // Phase 4 moved the template text out of a Postgres registry table and
        // onto the row. The normaliser is TypeScript, so an event stored
        // without it belongs to a group nothing can name — and nothing else in
        // this suite would notice, because the *hash* would still be right and
        // the grouping would still work.
        await ingestBatch(
            [event({ message: "User u_1 signed in" }), event({ message: "User u_2 signed in" })],
            ctx,
        );

        const rows = clickhouseRows();
        expect(rows.map((row) => row.message_template)).toEqual([
            "User *** signed in",
            "User *** signed in",
        ]);
        expect(rows[0].template_hash).toBe(rows[1].template_hash);
    });

    it("rejects the conflicting events in a batch and stores the rest", async () => {
        // The attribute-type registry is the one Postgres table left on this
        // path. `resolveAttributeTypes` returns no rows through the stub, so
        // every candidate type is accepted as first-seen and the batch is
        // whole — which is what makes the assertion below about *plumbing*
        // rather than about the conflict rules, covered in attribute-types.
        const result = await ingestBatch([event({ attributes: { n: 1 } }), event()], ctx);

        expect(result.accepted).toBe(2);
        expect(result.errors).toEqual([]);
        expect(clickhouseRows()).toHaveLength(2);
    });
});
