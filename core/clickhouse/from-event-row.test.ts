import { describe, it, expect } from "vitest";
import { fromClickhouseRow, fromClickhouseIp } from "./from-event-row";
import { toClickhouseRow } from "@/features/ingest/utils/to-clickhouse-row";
import { fingerprintMessage } from "@/features/ingest/utils/normalize-message";
import type { ClickhouseEventReadRow } from "@/core/clickhouse/event-row.types";
import type { NewEvent } from "@/shared/types/event.types";

/**
 * The round trip is the point of this file.
 *
 * `to-clickhouse-row.ts` flattens a `NewEvent` into what the column types
 * accept — nulls become empty strings, an address becomes IPv6, a signed
 * fingerprint becomes unsigned. If this mapper does not undo all of that
 * exactly, the events table shows `::ffff:1.2.3.4` where it used to show
 * `1.2.3.4`, or `""` where a field used to be absent, and no type error says so.
 */

const ID = "01920000-0000-7000-8000-000000000001";
const PROJECT = "11111111-1111-4111-8111-111111111111";

function readRow(patch: Partial<ClickhouseEventReadRow> = {}): ClickhouseEventReadRow {
    return {
        id: ID,
        project_id: PROJECT,
        ts_ms: 1787738400123,
        level: "info",
        message: "hello",
        source: "",
        environment: "",
        release: "",
        error_type: "",
        user_id: "",
        session_id: "",
        request_id: "",
        trace_id: "",
        stack_trace: "",
        attributes: {},
        context: "{}",
        user_agent: "",
        ip: "::",
        template_hash: "0",
        ...patch,
    };
}

describe("fromClickhouseIp", () => {
    it("unwraps a v4-mapped address back to the dotted form", () => {
        expect(fromClickhouseIp("::ffff:203.0.113.7")).toBe("203.0.113.7");
    });

    it("leaves a real IPv6 address alone", () => {
        expect(fromClickhouseIp("2001:db8::1")).toBe("2001:db8::1");
    });

    it("leaves an IPv6 address that merely starts with the prefix alone", () => {
        // `::ffff:1:2` is not a v4-mapped address; stripping the prefix would
        // turn a valid address into the nonsense `1:2`.
        expect(fromClickhouseIp("::ffff:1:2")).toBe("::ffff:1:2");
    });

    it("reads the unknown-address sentinel as absent", () => {
        expect(fromClickhouseIp("::")).toBeNull();
        expect(fromClickhouseIp("")).toBeNull();
    });
});

describe("fromClickhouseRow", () => {
    it("turns epoch milliseconds back into a Date", () => {
        expect(fromClickhouseRow(readRow()).timestamp.toISOString()).toBe("2026-08-26T10:00:00.123Z");
    });

    it("accepts the millisecond count as a string as well as a number", () => {
        // Which of the two arrives depends on
        // `output_format_json_quote_64bit_integers`, and that is set per query.
        expect(fromClickhouseRow(readRow({ ts_ms: "1787738400123" })).timestamp.getTime()).toBe(
            1787738400123,
        );
    });

    it("reads every empty string back as null", () => {
        const event = fromClickhouseRow(readRow());

        expect(event.source).toBeNull();
        expect(event.environment).toBeNull();
        expect(event.release).toBeNull();
        expect(event.errorType).toBeNull();
        expect(event.userId).toBeNull();
        expect(event.sessionId).toBeNull();
        expect(event.requestId).toBeNull();
        expect(event.traceId).toBeNull();
        expect(event.stackTrace).toBeNull();
        expect(event.userAgent).toBeNull();
        expect(event.ip).toBeNull();
    });

    it("keeps a value that happens to be present", () => {
        const event = fromClickhouseRow(readRow({ source: "api", environment: "production" }));

        expect(event.source).toBe("api");
        expect(event.environment).toBe("production");
    });

    it("renames the columns back to the schema's camelCase", () => {
        const event = fromClickhouseRow(
            readRow({
                user_id: "u_1",
                session_id: "s_1",
                request_id: "r_1",
                trace_id: "t_1",
                error_type: "TimeoutError",
                stack_trace: "at foo()",
                user_agent: "sdk/2.0",
                project_id: PROJECT,
            }),
        );

        expect(event.userId).toBe("u_1");
        expect(event.sessionId).toBe("s_1");
        expect(event.requestId).toBe("r_1");
        expect(event.traceId).toBe("t_1");
        expect(event.errorType).toBe("TimeoutError");
        expect(event.stackTrace).toBe("at foo()");
        expect(event.userAgent).toBe("sdk/2.0");
        expect(event.projectId).toBe(PROJECT);
    });

    it("parses the context blob back into an object", () => {
        expect(fromClickhouseRow(readRow({ context: '{"path":"/login"}' })).context).toEqual({
            path: "/login",
        });
    });

    it("gives an empty object for an empty or unparseable context", () => {
        // One malformed row must not take a whole page of events down with it.
        expect(fromClickhouseRow(readRow({ context: "" })).context).toEqual({});
        expect(fromClickhouseRow(readRow({ context: "not json" })).context).toEqual({});
        expect(fromClickhouseRow(readRow({ context: "[1,2]" })).context).toEqual({});
        expect(fromClickhouseRow(readRow({ context: "null" })).context).toEqual({});
    });

    it("passes attributes through as the object the JSON column gave", () => {
        const attributes = { order_id: "o_1", retries: 2, ok: true };
        expect(fromClickhouseRow(readRow({ attributes })).attributes).toEqual(attributes);
    });

    it("reads the fingerprint without going through a number", () => {
        // The column is UInt64 and the query folds it with reinterpretAsInt64;
        // `Number` anywhere in this path would quietly drop the low bits.
        expect(fromClickhouseRow(readRow({ template_hash: "-9223372036854775808" })).templateHash).toBe(
            BigInt("-9223372036854775808"),
        );
    });
});

describe("the round trip through both mappers", () => {
    function newEvent(patch: Partial<NewEvent> = {}): NewEvent {
        return {
            id: ID,
            projectId: PROJECT,
            timestamp: new Date("2026-08-26T10:00:00.123Z"),
            level: "warn",
            message: "User u_1 signed in",
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
            templateHash: fingerprintMessage("User u_1 signed in").hash,
            messageTemplate: fingerprintMessage("User u_1 signed in").template,
            ...patch,
        } as NewEvent;
    }

    /**
     * Stands in for the server: takes what the write mapper produced and
     * presents it the way the read query's `SELECT` list does. The types the
     * server itself converts — timestamp, level, fingerprint — are converted
     * here the same way, which is what makes this a mapper test rather than a
     * pretend integration test.
     */
    function throughStorage(row: NewEvent): ClickhouseEventReadRow {
        const stored = toClickhouseRow(row);
        return {
            id: stored.id,
            project_id: stored.project_id,
            ts_ms: Date.parse(`${stored.timestamp.replace(" ", "T")}Z`),
            level: stored.level,
            message: stored.message,
            source: stored.source,
            environment: stored.environment,
            release: stored.release,
            error_type: stored.error_type,
            user_id: stored.user_id,
            session_id: stored.session_id,
            request_id: stored.request_id,
            trace_id: stored.trace_id,
            stack_trace: stored.stack_trace,
            attributes: stored.attributes,
            context: stored.context,
            user_agent: stored.user_agent,
            // IPv4 is stored v4-mapped by the column, which the write mapper
            // does not do and the read mapper has to undo.
            ip: stored.ip.includes(".") && stored.ip !== "::" ? `::ffff:${stored.ip}` : stored.ip,
            // No fold. Until Phase 4 the column was read back through
            // `reinterpretAsInt64`, because Postgres held the same fingerprint
            // in a signed `bigint` and the two had to agree. There is one store
            // and one range now.
            template_hash: stored.template_hash,
        };
    }

    /**
     * What a round trip is allowed to lose.
     *
     * `NewEvent` carries `messageTemplate` and `Event` does not, on purpose:
     * the template is computed at ingest by a TypeScript normaliser and is
     * needed for *grouping*, while no read surface displays an individual
     * event's template — so the read query does not select it. Stripping it
     * here states that asymmetry rather than papering over it; if a widget ever
     * needs the template per event, this line is what has to change first.
     */
    function readable(row: NewEvent): Omit<NewEvent, "messageTemplate"> {
        const { messageTemplate: _dropped, ...rest } = row;
        return rest;
    }

    it("returns an all-absent event unchanged", () => {
        const original = newEvent();
        expect(fromClickhouseRow(throughStorage(original))).toEqual(readable(original));
    });

    it("keeps a fingerprint above 2^63 intact, which is where the fold used to sit", () => {
        // `User u_1 signed in` hashes to 12497911170121219274 — past the signed
        // range Postgres could hold. Reading it back as a negative number would
        // put the event in a different group and nothing would raise.
        const original = newEvent();
        expect(original.templateHash > BigInt("9223372036854775807")).toBe(true);
        expect(fromClickhouseRow(throughStorage(original)).templateHash).toBe(original.templateHash);
    });

    it("returns a fully populated event unchanged", () => {
        const original = newEvent({
            source: "api",
            environment: "production",
            release: "v1.2.3",
            errorType: "TimeoutError",
            userId: "u_1",
            sessionId: "s_1",
            requestId: "r_1",
            traceId: "t_1",
            stackTrace: "at foo()",
            userAgent: "sdk/2.0",
            ip: "203.0.113.7",
            attributes: { order_id: "o_1", retries: 2, ok: true },
            context: { path: "/login" },
        });

        expect(fromClickhouseRow(throughStorage(original))).toEqual(readable(original));
    });

    it("cannot distinguish an unparseable address from none, and says none", () => {
        // The write path stores `::` for both. That is a real, deliberate loss
        // — recorded here so it is a decision rather than a surprise.
        const stored = throughStorage(newEvent({ ip: "proxy.internal" }));
        expect(fromClickhouseRow(stored).ip).toBeNull();
    });

    it("cannot distinguish an empty string from an absent field, and says absent", () => {
        // The other deliberate loss, and the reason `.min(1)` became a
        // normalisation at ingest: a blank never reaches storage in the first
        // place, so nothing can observe the difference.
        const stored = throughStorage(newEvent({ source: "" }));
        expect(fromClickhouseRow(stored).source).toBeNull();
    });
});
