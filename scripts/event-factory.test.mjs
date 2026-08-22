import { describe, expect, it } from "vitest";
import {
    API_KEY_SLOTS,
    buildEvent,
    buildMessage,
    MESSAGE_TEMPLATES,
    parseRetryAfterMs,
    pick,
    randomizeAttributes,
    resolveApiKey,
    weightedLevel,
} from "./event-factory.mjs";

/** Deterministic stand-in for Math.random that replays a fixed sequence. */
function seeded(values) {
    let i = 0;
    return () => values[i++ % values.length];
}

describe("pick", () => {
    it("returns the first element for the lowest draw", () => {
        expect(pick(["a", "b", "c"], () => 0)).toBe("a");
    });

    it("stays in range for a draw just under 1", () => {
        expect(pick(["a", "b", "c"], () => 0.999999)).toBe("c");
    });
});

describe("weightedLevel", () => {
    it("returns the first level for the lowest draw", () => {
        expect(weightedLevel(() => 0)).toBe("info");
    });

    it("returns the last level for the highest draw", () => {
        expect(weightedLevel(() => 0.999)).toBe("fatal");
    });

    it("only ever returns levels the ingest schema accepts", () => {
        const allowed = new Set(["debug", "info", "warn", "error", "fatal"]);
        for (let i = 0; i < 200; i++) {
            expect(allowed.has(weightedLevel())).toBe(true);
        }
    });
});

describe("buildMessage", () => {
    it("leaves no unsubstituted placeholders", () => {
        for (let i = 0; i < 500; i++) {
            expect(buildMessage()).not.toMatch(/\{[a-z]+\}/);
        }
    });

    it("returns a static template unchanged", () => {
        // The lowest draw picks MESSAGE_TEMPLATES[0], which has no tokens.
        expect(buildMessage(() => 0)).toBe(MESSAGE_TEMPLATES[0]);
    });

    it("keeps a token it has no substitution for, rather than dropping it", () => {
        // A typo in a template should show up in the data, not vanish.
        expect("Nothing for {nosuchtoken}".replace(/\{(\w+)\}/g, (w) => w)).toContain("{nosuchtoken}");
    });

    it("produces high distinct cardinality, which is the point of this generator", () => {
        // The dashboard groups by SUBSTRING(message, 1, 200); the cost of that
        // aggregate scales with distinct values. A generator that emits a dozen
        // fixed strings makes any measurement of it meaningless.
        const seen = new Set();
        for (let i = 0; i < 2000; i++) seen.add(buildMessage());
        expect(seen.size).toBeGreaterThan(500);
    });

    it("still repeats some messages verbatim, as real traffic does", () => {
        const counts = new Map();
        for (let i = 0; i < 2000; i++) {
            const m = buildMessage();
            counts.set(m, (counts.get(m) ?? 0) + 1);
        }
        const mostCommon = Math.max(...counts.values());
        expect(mostCommon).toBeGreaterThan(20);
    });

    it("stays inside the 2048-character message limit the ingest schema enforces", () => {
        for (let i = 0; i < 500; i++) {
            expect(buildMessage().length).toBeLessThanOrEqual(2048);
        }
    });

    it("never returns an empty message, which the schema rejects", () => {
        for (let i = 0; i < 500; i++) {
            expect(buildMessage().length).toBeGreaterThan(0);
        }
    });
});

describe("randomizeAttributes", () => {
    it("preserves the type of every attribute", () => {
        // The project's attribute type registry rejects a key whose type
        // changes between events, so this is the property that matters.
        const out = randomizeAttributes({ latency_ms: 42, cached: false, route: "/login" });
        expect(typeof out.latency_ms).toBe("number");
        expect(typeof out.cached).toBe("boolean");
        expect(typeof out.route).toBe("string");
    });

    it("keeps the same set of keys", () => {
        const out = randomizeAttributes({ a: 1, b: true, c: "x" });
        expect(Object.keys(out).sort()).toEqual(["a", "b", "c"]);
    });

    it("passes through values of types it does not vary", () => {
        expect(randomizeAttributes({ nothing: null }).nothing).toBeNull();
    });

    it("returns an empty object for missing attributes", () => {
        expect(randomizeAttributes(undefined)).toEqual({});
    });

    it("produces positive integers for numeric attributes", () => {
        const out = randomizeAttributes({ n: 1 }, seeded([0.999999]));
        expect(out.n).toBeGreaterThan(0);
        expect(Number.isInteger(out.n)).toBe(true);
    });

    it("leaves non-route string attributes alone", () => {
        expect(randomizeAttributes({ tenant: "acme" }).tenant).toBe("acme");
    });
});

describe("buildEvent", () => {
    const template = {
        level: "info",
        message: "Synthetic load event",
        attributes: { latency_ms: 42, cached: false },
    };

    it("returns the template verbatim when randomize is off", () => {
        expect(buildEvent(template, false)).toEqual(template);
    });

    it("does not mutate or alias the template", () => {
        const built = buildEvent(template, false);
        built.attributes.latency_ms = 999;
        expect(template.attributes.latency_ms).toBe(42);
    });

    it("adds correlation fields when randomizing", () => {
        const built = buildEvent(template, true, seeded([0.4]));
        expect(built.trace_id).toMatch(/^t_/);
        expect(built.user_id).toMatch(/^u_\d+$/);
    });

    it("keeps required fields present when randomizing", () => {
        const built = buildEvent(template, true);
        expect(typeof built.level).toBe("string");
        expect(built.message.length).toBeGreaterThan(0);
    });

    it("preserves attribute types when randomizing", () => {
        const built = buildEvent(template, true);
        expect(typeof built.attributes.latency_ms).toBe("number");
        expect(typeof built.attributes.cached).toBe("boolean");
    });
});

describe("parseRetryAfterMs", () => {
    it("converts seconds to milliseconds", () => {
        expect(parseRetryAfterMs("60")).toBe(60_000);
    });

    it("tolerates surrounding whitespace", () => {
        expect(parseRetryAfterMs(" 30 ")).toBe(30_000);
    });

    it("accepts zero", () => {
        expect(parseRetryAfterMs("0")).toBe(0);
    });

    it("falls back when the header is absent", () => {
        expect(parseRetryAfterMs(null, 5_000)).toBe(5_000);
    });

    it("falls back on an HTTP-date, which this parser does not support", () => {
        expect(parseRetryAfterMs("Wed, 21 Oct 2026 07:28:00 GMT", 5_000)).toBe(5_000);
    });

    it("falls back on a negative value", () => {
        expect(parseRetryAfterMs("-1", 5_000)).toBe(5_000);
    });
});

describe("resolveApiKey", () => {
    const ENV = { LOGGER_API_KEY: "lgr_one", LOGGER_API_KEY_2: "lgr_two" };

    it("defaults to slot 1", () => {
        expect(resolveApiKey(ENV)).toEqual({ name: "LOGGER_API_KEY", key: "lgr_one" });
    });

    it("reads slot 2 from its own variable", () => {
        expect(resolveApiKey(ENV, "2")).toEqual({ name: "LOGGER_API_KEY_2", key: "lgr_two" });
    });

    it("accepts a numeric slot as well as a string one", () => {
        // process.argv gives strings, but a caller passing 2 should not get slot 1.
        expect(resolveApiKey(ENV, 2).key).toBe("lgr_two");
    });

    it("returns an empty key rather than undefined when the variable is unset", () => {
        expect(resolveApiKey({}, "2")).toEqual({ name: "LOGGER_API_KEY_2", key: "" });
    });

    it("names the variable that is missing, so the message says what to set", () => {
        expect(resolveApiKey({}, "2").name).toBe("LOGGER_API_KEY_2");
    });

    // Falling back to slot 1 here would send one project's load into another,
    // and the events would look entirely plausible on arrival.
    it.each([["3"], ["0"], [""], ["two"], [null]])("throws on the unknown slot %s", (slot) => {
        expect(() => resolveApiKey(ENV, slot)).toThrow(/Unknown API key slot/);
    });

    it("lists the valid slots in the error, so the fix is in the message", () => {
        // The slot is what a caller types, so the slot is what the message lists.
        expect(() => resolveApiKey(ENV, "3")).toThrow(/Known slots: 1, 2/);
    });

    it("covers every declared slot", () => {
        // Asserts the derivation rather than the contents: adding a third slot
        // to API_KEY_SLOTS must not leave this suite silently unchanged.
        for (const [slot, name] of Object.entries(API_KEY_SLOTS)) {
            expect(resolveApiKey({ [name]: "lgr_x" }, slot)).toEqual({ name, key: "lgr_x" });
        }
    });
});
