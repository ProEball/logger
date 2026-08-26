import { describe, it, expect } from "vitest";
import { compileFilters } from "./filter-compiler";
import { messageTokens } from "./search-query";
import type { EventFilters } from "@/shared/utils/event-filters.schema";

/**
 * What this file can and cannot prove.
 *
 * It proves the *structure*: which clauses appear, that every user-supplied
 * value is bound rather than spliced, and that a filter which is absent
 * contributes nothing. It cannot prove ClickHouse accepts the result — that is
 * `features/events/services/events-query.service.itest.ts`, which runs the same
 * shapes against a real server, and it exists because the write path already
 * had three assumptions that only failed at the wire (§12.2).
 *
 * So the assertions below are deliberately about the clause list, not about one
 * exact SQL string: a test pinned to whitespace breaks on every refactor and
 * catches nothing.
 */

const PROJECT = "11111111-1111-4111-8111-111111111111";
const FROM = new Date("2026-08-26T09:00:00.000Z");
const TO = new Date("2026-08-26T10:00:00.000Z");

const RANGE: EventFilters["range"] = { type: "preset", value: "1h" };

function compile(filters: Partial<EventFilters> = {}, exclude?: Parameters<typeof compileFilters>[2]["exclude"]) {
    return compileFilters(PROJECT, { range: RANGE, ...filters }, { from: FROM, to: TO, exclude });
}

/** Every placeholder the clause references, in order of appearance. */
function placeholders(where: string): string[] {
    return [...where.matchAll(/\{(\w+):/g)].map((match) => match[1]);
}

describe("the scope every query carries", () => {
    it("binds the project and both ends of the window", () => {
        const { where, params } = compile();

        expect(where).toBe(
            "project_id = {p0:UUID} AND timestamp >= {p1:DateTime64(3, 'UTC')}" +
                " AND timestamp <= {p2:DateTime64(3, 'UTC')}",
        );
        expect(params).toEqual({ p0: PROJECT, p1: FROM, p2: TO });
    });

    it("passes the Dates through unconverted", () => {
        // `@clickhouse/client` formats a Date as a unix timestamp with
        // milliseconds, which `DateTime64(3)` parses. Formatting it here would
        // be a second implementation of that, and the ISO form is the one the
        // server rejects.
        const { params } = compile();
        expect(params.p1).toBeInstanceOf(Date);
        expect(params.p2).toBeInstanceOf(Date);
    });

    it("closes the window at `to` by default and opens it when asked", () => {
        expect(compile().where).toContain("timestamp <= {p2:");

        const halfOpen = compileFilters(PROJECT, { range: RANGE }, { from: FROM, to: TO, toExclusive: true });
        expect(halfOpen.where).toContain("timestamp < {p2:");
        expect(halfOpen.where).not.toContain("timestamp <= ");
    });
});

describe("the multi-value fields", () => {
    it("binds each as one array, not one parameter per member", () => {
        const { where, params } = compile({ levels: ["error", "fatal"] });

        expect(where).toContain("level IN {p3:Array(String)}");
        expect(params.p3).toEqual(["error", "fatal"]);
    });

    it("maps every field to its column", () => {
        const { where } = compile({
            levels: ["error"],
            environments: ["production"],
            sources: ["api"],
            releases: ["v1"],
            errorTypes: ["TimeoutError"],
        });

        expect(where).toContain("level IN ");
        expect(where).toContain("environment IN ");
        expect(where).toContain("source IN ");
        expect(where).toContain("release IN ");
        expect(where).toContain("error_type IN ");
    });

    it("contributes nothing when the array is empty", () => {
        // `parse-filters.ts` never produces an empty array, but a Server Action
        // is a public entry point and `IN []` is not what "no filter" means.
        expect(compile({ levels: [], sources: [] }).where).toBe(compile().where);
    });

    it("leaves out only the excluded field, keeping the rest", () => {
        const { where } = compile({ levels: ["error"], sources: ["api"] }, ["levels"]);

        expect(where).not.toContain("level IN ");
        expect(where).toContain("source IN ");
    });
});

describe("the correlation ids", () => {
    it("binds each as an equality on its column", () => {
        const { where, params } = compile({
            userId: "u_1",
            sessionId: "s_1",
            requestId: "r_1",
            traceId: "t_1",
        });

        expect(where).toContain("user_id = {p3:String}");
        expect(where).toContain("session_id = {p4:String}");
        expect(where).toContain("request_id = {p5:String}");
        expect(where).toContain("trace_id = {p6:String}");
        expect(params.p3).toBe("u_1");
        expect(params.p6).toBe("t_1");
    });

    it("ignores a blank id", () => {
        expect(compile({ userId: "" }).where).toBe(compile().where);
    });
});

describe("the message search", () => {
    it("asks the index for a single word", () => {
        const { where, params } = compile({ message: "timeout" });

        expect(where).toContain("hasToken(message_lower, {p3:String})");
        expect(where).not.toContain("position(");
        expect(params.p3).toBe("timeout");
    });

    it("never passes hasToken a needle the server would reject", () => {
        // An empty needle, or one containing a separator, is BAD_ARGUMENTS —
        // a 500 on the events page rather than an empty result. The property
        // asserted is that every bound needle is exactly one token by the
        // tokenizer own rule; the integration suite is what proves that rule
        // agrees with ClickHouse.
        const { where, params } = compile({
            message: '"connection refused" foo_bar api.users -a-b +++ 30s',
        });

        const needles = [...where.matchAll(/hasToken\(message_lower, \{(\w+):String\}\)/g)].map(
            (match) => String(params[match[1]]),
        );

        expect(needles.length).toBeGreaterThan(0);
        for (const needle of needles) {
            expect(messageTokens(needle)).toEqual([needle]);
        }
    });

    it("adds the adjacency check for a phrase", () => {
        const { where, params } = compile({ message: '"connection refused"' });

        expect(where).toContain("hasToken(message_lower, {p3:String})");
        expect(where).toContain("hasToken(message_lower, {p4:String})");
        expect(where).toContain("position(message_lower, {p5:String}) > 0");
        expect(params.p5).toBe("connection refused");
    });

    it("negates a term as a whole, not term by term", () => {
        // `NOT (a AND b)` and `NOT a AND NOT b` are different questions, and
        // for a phrase only the first one is the right one.
        const { where } = compile({ message: '-"connection refused"' });
        expect(where).toContain("NOT (hasToken");
        expect(where).toMatch(/NOT \(hasToken.+AND hasToken.+AND position.+\)/);
    });

    it("ORs the groups and ANDs within them", () => {
        const { where } = compile({ message: "a b or c" });
        expect(where).toContain(
            "((hasToken(message_lower, {p3:String}) AND hasToken(message_lower, {p4:String}))" +
                " OR (hasToken(message_lower, {p5:String})))",
        );
    });

    it("falls back to a substring test when the tokenizer finds nothing", () => {
        const { where, params } = compile({ message: "+++" });

        expect(where).not.toContain("hasToken");
        expect(where).toContain("position(message_lower, {p3:String}) > 0");
        expect(params.p3).toBe("+++");
    });

    it("contributes nothing for a blank search", () => {
        expect(compile({ message: "" }).where).toBe(compile().where);
        expect(compile({ message: "   " }).where).toBe(compile().where);
    });
});

describe("the attribute filters", () => {
    it("binds the key as a parameter, so no part of it reaches the SQL text", () => {
        // The reason this matters: an attribute key is a string out of a URL,
        // and it addresses a *column path*. Identifiers cannot normally be
        // bound, which is why `getSubcolumn` was checked against the server
        // before this compiler was written.
        const { where, params } = compile({ attributes: [{ key: "order_id", value: "o_1" }] });

        expect(where).toContain("toString(getSubcolumn(attributes, {p3:String})) = {p4:String}");
        expect(params.p3).toBe("order_id");
        expect(params.p4).toBe("o_1");
        expect(where).not.toContain("order_id");
    });

    it("keeps a hostile key inside a parameter", () => {
        const key = "a') OR 1=1 --";
        const { where, params } = compile({ attributes: [{ key, value: "x" }] });

        expect(where).not.toContain("OR 1=1");
        expect(Object.values(params)).toContain(key);
    });

    it("asserts the path exists when the value searched for is blank", () => {
        // `toString` of a path no row has is `''`, so without this every event
        // that never carried the key would match.
        const { where } = compile({ attributes: [{ key: "k", value: "" }] });
        expect(where).toContain("dynamicType(getSubcolumn(attributes, {p3:String})) != 'None'");
    });

    it("does not pay for the existence check on a non-blank value", () => {
        const { where } = compile({ attributes: [{ key: "k", value: "v" }] });
        expect(where).not.toContain("dynamicType");
    });

    it("ANDs several attribute filters", () => {
        const { where } = compile({
            attributes: [
                { key: "a", value: "1" },
                { key: "b", value: "2" },
            ],
        });

        expect(placeholders(where).length).toBe(7);
        expect(where.match(/getSubcolumn/g)).toHaveLength(2);
    });
});

describe("everything at once", () => {
    it("joins every clause with AND and binds every value exactly once", () => {
        const { where, params } = compile({
            levels: ["error"],
            environments: ["production"],
            userId: "u_1",
            message: "timeout",
            attributes: [{ key: "order_id", value: "o_1" }],
        });

        const names = placeholders(where);
        expect(new Set(names).size).toBe(names.length);
        expect(Object.keys(params).sort()).toEqual([...names].sort());
        expect(where.split(" AND ").length).toBeGreaterThanOrEqual(7);
    });

    it("puts nothing in the clause that is not a placeholder or a column name", () => {
        // The blunt form of the parameter-binding rule: no user-supplied
        // substring survives into the SQL.
        const { where } = compile({
            environments: ["'; DROP TABLE events; --"],
            userId: "{p0:UUID}",
            message: "') OR 1=1 --",
            attributes: [{ key: "x'", value: "y'" }],
        });

        expect(where).not.toContain("DROP TABLE");
        expect(where).not.toContain("OR 1=1");
        expect(where).not.toContain("y'");
    });
});
