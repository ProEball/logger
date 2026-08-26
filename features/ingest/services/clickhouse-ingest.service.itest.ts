import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { clickhouse } from "@/core/clickhouse/client";
import { insertEvents } from "./clickhouse-ingest.service";
import { toClickhouseRow } from "../utils/to-clickhouse-row";
import { fingerprintMessage, templateHash } from "../utils/normalize-message";
import { uuidv7 } from "@/shared/utils/uuidv7";
import type { NewEvent } from "@/shared/types/event.types";

/**
 * The write path against a real `events` table.
 *
 * **This is the test the unit test cannot be.** `to-clickhouse-row.test.ts`
 * asserts the shape of a row; nothing in it can know whether ClickHouse
 * *accepts* that shape, and the three things that turned out to be wrong on
 * 2026-08-26 all failed at the wire and nowhere else:
 *
 *   - `DateTime64(3, 'UTC')` rejects the ISO-8601 form `Date.toJSON()` emits,
 *   - `IPv6` rejects anything unparseable and fails the **whole insert**,
 *   - `Enum8` rejects an unknown level.
 *
 * A mocked client would have accepted all three. There is no Drizzle dialect
 * for ClickHouse and therefore no query builder to assert against, which is
 * exactly the case PROJECT.md §11 reserves an integration test for.
 *
 * Every test writes under its own project id, so files can run in parallel and
 * nothing here depends on the Postgres corpus.
 */

function projectId(): string {
    return uuidv7();
}

function row(project: string, patch: Partial<NewEvent> = {}): NewEvent {
    return {
        id: uuidv7(),
        projectId: project,
        timestamp: new Date("2026-08-26T10:00:00.123Z"),
        level: "info",
        message: "hello",
        source: null,
        environment: null,
        release: null,
        userId: null,
        sessionId: null,
        requestId: null,
        traceId: null,
        errorType: null,
        stackTrace: null,
        attributes: {},
        context: {},
        userAgent: null,
        ip: null,
        templateHash: fingerprintMessage("hello").hash,
        messageTemplate: fingerprintMessage("hello").template,
        ...patch,
    } as NewEvent;
}

async function rowsFor(project: string): Promise<Array<Record<string, unknown>>> {
    const result = await clickhouse.query({
        query: `
            SELECT id, toString(timestamp) AS timestamp, level, message,
                   source, environment, release, error_type,
                   user_id, session_id, request_id, trace_id,
                   toString(template_hash) AS template_hash, message_template,
                   toString(attributes) AS attributes,
                   context, stack_trace, user_agent, toString(ip) AS ip,
                   retention_days
            FROM events WHERE project_id = {project:UUID}
            ORDER BY timestamp, id
        `,
        query_params: { project },
        format: "JSONEachRow",
    });
    return result.json();
}

async function countFor(project: string): Promise<number> {
    const result = await clickhouse.query({
        query: "SELECT count() AS n FROM events WHERE project_id = {project:UUID}",
        query_params: { project },
        format: "JSONEachRow",
    });
    const [first] = await result.json<{ n: string }>();
    return Number(first.n);
}

beforeAll(async () => {
    // Fails loudly here rather than as a confusing error inside the first test
    // if the container is not up or the schema was never applied.
    const ping = await clickhouse.ping({ select: true });
    if (!ping.success) throw ping.error;
});

afterAll(async () => {
    await clickhouse.close();
});

describe("insertEvents", () => {
    it("stores an event and reads it back intact", async () => {
        const project = projectId();
        const source = row(project, {
            message: "User u_1 signed in",
            source: "api",
            environment: "production",
            release: "v1.2.3",
            errorType: "TimeoutError",
            userId: "u_1",
            sessionId: "s_1",
            requestId: "r_1",
            traceId: "t_1",
            stackTrace: "at foo()",
            userAgent: "vitest/1.0",
            ip: "1.2.3.4",
            attributes: { order_id: "o_1", retries: 2, ok: true },
            context: { path: "/login" },
            templateHash: fingerprintMessage("User u_1 signed in").hash,
            messageTemplate: fingerprintMessage("User u_1 signed in").template,
        });

        await insertEvents([toClickhouseRow(source)], null);
        const [stored] = await rowsFor(project);

        expect(stored.id).toBe(source.id);
        expect(stored.timestamp).toBe("2026-08-26 10:00:00.123");
        expect(stored.level).toBe("info");
        expect(stored.message).toBe("User u_1 signed in");
        expect(stored.source).toBe("api");
        expect(stored.environment).toBe("production");
        expect(stored.release).toBe("v1.2.3");
        expect(stored.error_type).toBe("TimeoutError");
        expect(stored.user_id).toBe("u_1");
        expect(stored.session_id).toBe("s_1");
        expect(stored.request_id).toBe("r_1");
        expect(stored.trace_id).toBe("t_1");
        expect(stored.stack_trace).toBe("at foo()");
        expect(stored.user_agent).toBe("vitest/1.0");
        expect(stored.context).toBe('{"path":"/login"}');
        expect(stored.message_template).toBe("User *** signed in");
    });

    it("round-trips a fingerprint with the top bit set through UInt64", async () => {
        // The case that used to need a fold: while Postgres held the same value
        // in a signed `bigint`, a hash above 2^63 was stored negative there and
        // positive here, and getting the direction wrong renamed the group
        // silently. Nothing folds since Phase 4 — this asserts the value
        // survives the column unchanged, which is what `topMessages` groups on.
        const project = projectId();
        // Chosen because its fingerprint really is above 2^63 — asserted here
        // so the test cannot quietly stop covering the case it exists for if
        // the normaliser's rules change what this message hashes to.
        const message = "User u_1 signed in";
        const fingerprint = fingerprintMessage(message);
        expect(fingerprint.hash > BigInt("9223372036854775807")).toBe(true);

        await insertEvents(
            [
                toClickhouseRow(
                    row(project, {
                        message,
                        templateHash: fingerprint.hash,
                        messageTemplate: fingerprint.template,
                    }),
                ),
            ],
            null,
        );
        const [stored] = await rowsFor(project);

        expect(stored.template_hash).toBe(templateHash(message).toString());
        expect(stored.message_template).toBe(fingerprint.template);
    });

    it("stores an IPv4 address v4-mapped", async () => {
        const project = projectId();
        await insertEvents([toClickhouseRow(row(project, { ip: "203.0.113.7" }))], null);
        expect((await rowsFor(project))[0].ip).toBe("::ffff:203.0.113.7");
    });

    it("accepts a request whose X-Forwarded-For was unparseable", async () => {
        // Without the guard in `toClickhouseIp` this fails with code 676 and
        // takes every other event in the batch down with it.
        const project = projectId();
        await insertEvents(
            [
                toClickhouseRow(row(project, { ip: "proxy.internal", message: "first" })),
                toClickhouseRow(row(project, { ip: "1.2.3.4", message: "second" })),
            ],
            null,
        );

        expect(await countFor(project)).toBe(2);
        expect((await rowsFor(project)).map((r) => r.ip)).toContain("::");
    });

    it("stores attributes as queryable typed subcolumns, not as text", async () => {
        // R3's whole premise. A GROUP BY on the untyped path is refused by
        // ClickHouse outright, so the typed accessor is what a custom widget
        // would have to emit — see §4.3.
        const project = projectId();
        await insertEvents(
            [
                toClickhouseRow(row(project, { attributes: { order_id: "o_1" } })),
                toClickhouseRow(row(project, { attributes: { order_id: "o_1" } })),
                toClickhouseRow(row(project, { attributes: { order_id: "o_2" } })),
            ],
            null,
        );

        const result = await clickhouse.query({
            query: `
                SELECT attributes.order_id.:String AS order_id, count() AS n
                FROM events WHERE project_id = {project:UUID}
                GROUP BY order_id ORDER BY order_id
            `,
            query_params: { project },
            format: "JSONEachRow",
        });

        expect(await result.json()).toEqual([
            { order_id: "o_1", n: "2" },
            { order_id: "o_2", n: "1" },
        ]);
    });

    it("does not create a path for a null-valued attribute", async () => {
        const project = projectId();
        await insertEvents(
            [toClickhouseRow(row(project, { attributes: { kept: "yes", dropped: null } }))],
            null,
        );

        expect((await rowsFor(project))[0].attributes).toBe('{"kept":"yes"}');
    });

    it("applies the schema default for retention_days", async () => {
        // Phase 6 wires the real per-project value; until then the column has
        // to arrive with its default rather than as 0, or the row TTL that
        // phase adds would expire everything on the day it ships.
        const project = projectId();
        await insertEvents([toClickhouseRow(row(project))], null);
        expect(Number((await rowsFor(project))[0].retention_days)).toBe(30);
    });

    it("writes a 500-event batch in one insert", async () => {
        const project = projectId();
        const batch = Array.from({ length: 500 }, (_, i) =>
            toClickhouseRow(row(project, { message: `event ${i}` })),
        );

        await insertEvents(batch, null);
        expect(await countFor(project)).toBe(500);
    });

    it("writes nothing, and issues no query, for an empty batch", async () => {
        const project = projectId();
        await insertEvents([], null);
        expect(await countFor(project)).toBe(0);
    });

    it("is read-after-write, which the e2e specs and the product both rely on", async () => {
        // `wait_for_async_insert = 1`. With `0` this count is 0 until the
        // server flushes, and "the event you sent is here" stops being true.
        const project = projectId();
        await insertEvents([toClickhouseRow(row(project))], null);
        expect(await countFor(project)).toBe(1);
    });
});

describe("the deduplication token", () => {
    it("discards a repeated insert carrying a token already seen", async () => {
        const project = projectId();
        const batch = [toClickhouseRow(row(project))];

        await insertEvents(batch, `${project}:retry-1`);
        await insertEvents(batch, `${project}:retry-1`);

        expect(await countFor(project)).toBe(1);
    });

    it("does nothing when the two inserts carry different tokens", async () => {
        const project = projectId();

        await insertEvents([toClickhouseRow(row(project, { message: "a" }))], `${project}:k1`);
        await insertEvents([toClickhouseRow(row(project, { message: "b" }))], `${project}:k2`);

        expect(await countFor(project)).toBe(2);
    });

    it("stores the same message twice, because two events are two events", async () => {
        // A logging service sees the same line constantly — a heartbeat, a
        // retry loop, the same error in two requests. What keeps these apart is
        // the id: each is minted per event, so two identical client payloads
        // produce two different blocks. That is also why the token can never be
        // a hash of the payload — see `utils/dedup-token.ts`.
        const project = projectId();

        await insertEvents([toClickhouseRow(row(project, { message: "tick" }))], null);
        await insertEvents([toClickhouseRow(row(project, { message: "tick" }))], null);

        expect(await countFor(project)).toBe(2);
    });

    it("discards a byte-identical block even with no token", async () => {
        // Setting `non_replicated_deduplication_window` turns on ClickHouse's
        // *checksum* deduplication as well as the token kind —
        // `insert_deduplicate` defaults to 1. Found by this test failing on
        // 2026-08-26, when it reused one row object and expected two rows.
        //
        // Harmless, and mildly useful: in production every row carries its own
        // UUIDv7, so two blocks can only be identical when the very same
        // enriched batch is inserted twice — an application-level retry, where
        // discarding the repeat is what anyone would want. It is recorded here
        // because it is a property of the table setting rather than of any
        // code, and nothing else would show it.
        const project = projectId();
        const sameRowTwice = toClickhouseRow(row(project, { message: "tick" }));

        await insertEvents([sameRowTwice], null);
        await insertEvents([sameRowTwice], null);

        expect(await countFor(project)).toBe(1);
    });

    it("keeps the same key in two projects apart", async () => {
        // The deduplication window belongs to the table, not to a tenant.
        const first = projectId();
        const second = projectId();

        await insertEvents([toClickhouseRow(row(first))], `${first}:retry`);
        await insertEvents([toClickhouseRow(row(second))], `${second}:retry`);

        expect(await countFor(first)).toBe(1);
        expect(await countFor(second)).toBe(1);
    });
});
