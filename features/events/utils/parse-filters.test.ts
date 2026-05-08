import { describe, it, expect } from "vitest";
import { parseFilters } from "./parse-filters";
import { serializeFilters } from "./serialize-filters";
import { parseCursor } from "./parse-cursor";
import { DEFAULT_FILTERS } from "./event-filters.types";

describe("parseFilters", () => {
    it("returns default range when no params", () => {
        const result = parseFilters(new URLSearchParams());
        expect(result).toEqual(DEFAULT_FILTERS);
    });

    it("parses preset range", () => {
        const result = parseFilters(new URLSearchParams("range=6h"));
        expect(result.range).toEqual({ type: "preset", value: "6h" });
    });

    it("falls back to default for invalid preset", () => {
        const result = parseFilters(new URLSearchParams("range=99h"));
        expect(result.range).toEqual(DEFAULT_FILTERS.range);
    });

    it("parses custom range", () => {
        const from = "2024-01-01T00:00:00.000Z";
        const to = "2024-01-02T00:00:00.000Z";
        const result = parseFilters(new URLSearchParams(`range_from=${from}&range_to=${to}`));
        expect(result.range).toEqual({ type: "custom", from, to });
    });

    it("falls back to default for invalid custom range", () => {
        const result = parseFilters(new URLSearchParams("range_from=not-a-date&range_to=also-not"));
        expect(result.range).toEqual(DEFAULT_FILTERS.range);
    });

    it("parses valid levels", () => {
        const result = parseFilters(new URLSearchParams("levels=error,fatal,info"));
        expect(result.levels).toEqual(["error", "fatal", "info"]);
    });

    it("strips invalid level value, keeps valid ones", () => {
        const result = parseFilters(new URLSearchParams("levels=error,INVALID,fatal"));
        expect(result.levels).toEqual(["error", "fatal"]);
    });

    it("omits levels if all invalid", () => {
        const result = parseFilters(new URLSearchParams("levels=INVALID"));
        expect(result.levels).toBeUndefined();
    });

    it("parses environments", () => {
        const result = parseFilters(new URLSearchParams("environments=production,staging"));
        expect(result.environments).toEqual(["production", "staging"]);
    });

    it("parses message", () => {
        const result = parseFilters(new URLSearchParams("message=timeout+error"));
        expect(result.message).toBe("timeout error");
    });

    it("parses attribute filters", () => {
        const result = parseFilters(new URLSearchParams("attribute.user_id=u_123&attribute.region=eu"));
        expect(result.attributes).toEqual([
            { key: "user_id", value: "u_123" },
            { key: "region", value: "eu" },
        ]);
    });

    it("parses correlation fields", () => {
        const result = parseFilters(
            new URLSearchParams("userId=u1&sessionId=s1&requestId=r1&traceId=t1"),
        );
        expect(result.userId).toBe("u1");
        expect(result.sessionId).toBe("s1");
        expect(result.requestId).toBe("r1");
        expect(result.traceId).toBe("t1");
    });

    it("unknown params are ignored", () => {
        const result = parseFilters(new URLSearchParams("unknown=foo&levels=error"));
        expect(result.levels).toEqual(["error"]);
        expect((result as Record<string, unknown>).unknown).toBeUndefined();
    });
});

describe("serializeFilters + parseFilters round-trip", () => {
    it("preset range round-trips", () => {
        const filters = {
            range: { type: "preset" as const, value: "6h" as const },
            levels: ["error", "fatal"] as Array<"error" | "fatal">,
            environments: ["production"],
            message: "timeout",
        };
        const params = serializeFilters(filters);
        const result = parseFilters(params);
        expect(result.range).toEqual(filters.range);
        expect(result.levels).toEqual(["error", "fatal"]);
        expect(result.environments).toEqual(["production"]);
        expect(result.message).toBe("timeout");
    });

    it("custom range round-trips", () => {
        const filters = {
            range: {
                type: "custom" as const,
                from: "2024-01-01T00:00:00.000Z",
                to: "2024-01-02T00:00:00.000Z",
            },
        };
        const params = serializeFilters(filters);
        const result = parseFilters(params);
        expect(result.range).toEqual(filters.range);
    });

    it("attribute filters round-trip", () => {
        const filters = {
            range: { type: "preset" as const, value: "1h" as const },
            attributes: [{ key: "user_id", value: "u_123" }],
        };
        const params = serializeFilters(filters);
        const result = parseFilters(params);
        expect(result.attributes).toEqual(filters.attributes);
    });
});

describe("parseCursor", () => {
    it("returns undefined when params missing", () => {
        expect(parseCursor(new URLSearchParams())).toBeUndefined();
    });

    it("returns undefined when only one param present", () => {
        expect(parseCursor(new URLSearchParams("before_ts=2024-01-01T00:00:00.000Z"))).toBeUndefined();
    });

    it("returns undefined for invalid timestamp", () => {
        const p = new URLSearchParams(
            "before_ts=not-a-date&before_id=00000000-0000-0000-0000-000000000000",
        );
        expect(parseCursor(p)).toBeUndefined();
    });

    it("returns cursor for valid params", () => {
        const ts = "2024-01-01T00:00:00.000Z";
        const id = "00000000-0000-0000-0000-000000000000";
        const result = parseCursor(new URLSearchParams(`before_ts=${ts}&before_id=${id}`));
        expect(result).toEqual({ beforeTs: ts, beforeId: id });
    });
});
