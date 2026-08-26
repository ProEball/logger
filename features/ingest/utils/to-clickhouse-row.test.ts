import { describe, it, expect } from "vitest";
import {
    formatClickhouseDateTime,
    toClickhouseIp,
    dropNullAttributes,
    toClickhouseRow,
    UNKNOWN_IP,
} from "./to-clickhouse-row";
import { fingerprintMessage, templateHash } from "./normalize-message";
import type { NewEvent } from "@/shared/types/event.types";

const PROJECT = "11111111-1111-4111-8111-111111111111";

function row(patch: Partial<NewEvent> = {}): NewEvent {
    return {
        id: "01994b0e-0000-7000-8000-000000000001",
        projectId: PROJECT,
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

describe("formatClickhouseDateTime", () => {
    it("emits the space-separated form DateTime64 accepts", () => {
        // ClickHouse 25.3 rejects the ISO form outright:
        // `Cannot parse input: expected '"' before: 'Z'`.
        expect(formatClickhouseDateTime(new Date("2026-08-26T10:00:00.123Z"))).toBe(
            "2026-08-26 10:00:00.123",
        );
    });

    it("keeps millisecond precision, which the column has and the viewer shows", () => {
        expect(formatClickhouseDateTime(new Date("2026-01-02T03:04:05.007Z"))).toBe(
            "2026-01-02 03:04:05.007",
        );
    });

    it("formats in UTC regardless of the server's zone", () => {
        // The column is DateTime64(3, 'UTC'); a local-time string would land
        // hours away and nothing would report an error.
        const midnightUtc = new Date(Date.UTC(2026, 0, 1, 0, 0, 0, 0));
        expect(formatClickhouseDateTime(midnightUtc)).toBe("2026-01-01 00:00:00.000");
    });

    it("contains neither of the two characters ClickHouse rejects", () => {
        const formatted = formatClickhouseDateTime(new Date());
        expect(formatted).not.toContain("T");
        expect(formatted).not.toContain("Z");
    });
});

describe("toClickhouseIp", () => {
    it("passes an IPv4 address through, which ClickHouse stores v4-mapped", () => {
        expect(toClickhouseIp("1.2.3.4")).toBe("1.2.3.4");
    });

    it("passes an IPv6 address through", () => {
        expect(toClickhouseIp("2001:db8::1")).toBe("2001:db8::1");
    });

    it("trims surrounding whitespace left by a proxy header", () => {
        expect(toClickhouseIp("  1.2.3.4  ")).toBe("1.2.3.4");
    });

    it.each([
        ["null", null],
        ["undefined", undefined],
        ["an empty string", ""],
        ["whitespace", "   "],
        ["a hostname", "proxy.internal"],
        ["an address with a port", "1.2.3.4:5678"],
        ["a truncated address", "1.2.3."],
        ["a bracketed v6 address with a port", "[2001:db8::1]:443"],
    ])("coerces %s to the unknown address", (_label, value) => {
        // Each of these fails the *whole* insert with code 676 if it reaches
        // the IPv6 column — for a batch that is 500 events lost to one
        // malformed header the caller never set.
        expect(toClickhouseIp(value)).toBe(UNKNOWN_IP);
    });
});

describe("dropNullAttributes", () => {
    it("keeps strings, numbers and booleans", () => {
        expect(dropNullAttributes({ a: "x", b: 2, c: true })).toEqual({ a: "x", b: 2, c: true });
    });

    it("drops a null value, which would otherwise spend a JSON path slot", () => {
        expect(dropNullAttributes({ a: "x", b: null })).toEqual({ a: "x" });
    });

    it("keeps false and zero, which are values rather than absences", () => {
        expect(dropNullAttributes({ a: false, b: 0, c: "" })).toEqual({ a: false, b: 0, c: "" });
    });

    it("returns an empty bag for null or undefined", () => {
        expect(dropNullAttributes(null)).toEqual({});
        expect(dropNullAttributes(undefined)).toEqual({});
    });
});

describe("toClickhouseRow", () => {
    it("maps every absent optional field to an empty string, never null", () => {
        // No column in the ClickHouse schema is Nullable (§4.1), so a null here
        // is not "unset" — it is a failed insert.
        const mapped = toClickhouseRow(row());

        expect(mapped.source).toBe("");
        expect(mapped.environment).toBe("");
        expect(mapped.release).toBe("");
        expect(mapped.error_type).toBe("");
        expect(mapped.user_id).toBe("");
        expect(mapped.session_id).toBe("");
        expect(mapped.request_id).toBe("");
        expect(mapped.trace_id).toBe("");
        expect(mapped.stack_trace).toBe("");
        expect(mapped.user_agent).toBe("");
    });

    it("contains no null and no undefined at all", () => {
        const mapped: Record<string, unknown> = { ...toClickhouseRow(row()) };
        for (const [key, value] of Object.entries(mapped)) {
            expect(value, `${key} must not be nullish`).not.toBeNull();
            expect(value, `${key} must not be nullish`).not.toBeUndefined();
        }
    });

    it("serialises context, because the column is String and not JSON", () => {
        const mapped = toClickhouseRow(row({ context: { requestPath: "/a" } }));
        expect(mapped.context).toBe('{"requestPath":"/a"}');
    });

    it("leaves attributes as an object, because that column *is* JSON", () => {
        const mapped = toClickhouseRow(row({ attributes: { order_id: "o1", retries: 2 } }));
        expect(mapped.attributes).toEqual({ order_id: "o1", retries: 2 });
    });

    it("emits the fingerprint unsigned, which is the range UInt64 holds", () => {
        // A message whose fingerprint has the top bit set is the case that used
        // to need a fold, back when Postgres' signed `bigint` held the same
        // value. Nothing folds now, so the assertion is that nothing negative
        // ever reaches a UInt64 column.
        const message = "User u_1 signed in";
        const mapped = toClickhouseRow(row({ message, templateHash: templateHash(message) }));

        expect(mapped.template_hash).toBe(templateHash(message).toString());
        expect(mapped.template_hash.startsWith("-")).toBe(false);
    });

    it("carries the template text through unchanged", () => {
        const mapped = toClickhouseRow(row({ messageTemplate: "User *** signed in" }));
        expect(mapped.message_template).toBe("User *** signed in");
    });

    it("emits the hash as a string, since UInt64 does not fit a JS number", () => {
        const mapped = toClickhouseRow(row());
        expect(typeof mapped.template_hash).toBe("string");
    });

    it("emits zero for a zero fingerprint rather than dropping the field", () => {
        // `templateHash` is no longer nullable — every row gets one at ingest —
        // so the edge that remains is the value itself being 0. It must still
        // reach the column as "0", because a missing key in JSONEachRow and a
        // stored zero are different things.
        expect(toClickhouseRow(row({ templateHash: BigInt(0) })).template_hash).toBe("0");
    });

    it("survives JSON.stringify, which is how it reaches ClickHouse", () => {
        // A bigint anywhere in the row throws here rather than at the wire, and
        // a Date silently becomes the ISO form the column rejects.
        const mapped = toClickhouseRow(row({ ip: "1.2.3.4", attributes: { a: 1 } }));
        expect(() => JSON.stringify(mapped)).not.toThrow();
        expect(JSON.parse(JSON.stringify(mapped)).timestamp).toBe("2026-08-26 10:00:00.123");
    });

    it("carries the id through unchanged, so both stores agree", () => {
        expect(toClickhouseRow(row()).id).toBe("01994b0e-0000-7000-8000-000000000001");
    });
});
