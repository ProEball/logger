import { describe, it, expect } from "vitest";
import { queryCacheKey } from "./query-cache-key";

/**
 * The shape every caller uses: a query name, a project scope, then a preset.
 * Defaults mirror the org overview so the assertions below read as questions
 * about the key rather than about the arguments.
 */
type Part = string | number | readonly string[] | null | undefined;
const key = (fn = "summaries", scope: readonly string[] = ["p1", "p2"], preset: Part = "7d", ...rest: Part[]) =>
    queryCacheKey(fn, scope, preset, ...rest);

describe("queryCacheKey", () => {
    describe("separates questions that have different answers", () => {
        it("separates different queries", () => {
            expect(key("summaries")).not.toBe(
                key("topErrors"),
            );
        });

        it("separates different presets", () => {
            expect(key(undefined, undefined, "7d")).not.toBe(
                key(undefined, undefined, "30d"),
            );
        });

        it("separates different environment filters", () => {
            expect(key(undefined, undefined, "7d", ["prod"])).not.toBe(
                key(undefined, undefined, "7d", ["dev"]),
            );
        });

        it("separates different bucket widths", () => {
            expect(key(undefined, undefined, "7d", undefined, 60)).not.toBe(
                key(undefined, undefined, "7d", undefined, 3600),
            );
        });

        it("does not confuse a preset with an environment filter", () => {
            expect(key(undefined, undefined, "prod")).not.toBe(
                key(undefined, undefined, null, ["prod"]),
            );
        });
    });

    /**
     * The scope is the permission boundary. These are the assertions that stop
     * a future per-project visibility rule from turning the cache into a leak
     * silently — see the header of `event-aggregations-cache.service.ts`.
     */
    describe("keeps project scopes apart", () => {
        it("separates disjoint project sets", () => {
            expect(key(undefined, ["p1"])).not.toBe(
                key(undefined, ["p2"]),
            );
        });

        it("separates a subset from its superset", () => {
            expect(key(undefined, ["p1"])).not.toBe(
                key(undefined, ["p1", "p2"]),
            );
        });

        it("separates an empty scope from a populated one", () => {
            expect(key(undefined, [])).not.toBe(
                key(undefined, ["p1"]),
            );
        });
    });

    describe("collapses questions that have the same answer", () => {
        it("ignores project order", () => {
            expect(key(undefined, ["p2", "p1"])).toBe(
                key(undefined, ["p1", "p2"]),
            );
        });

        it("ignores filter order", () => {
            expect(key(undefined, undefined, "7d", ["staging", "prod"])).toBe(
                key(undefined, undefined, "7d", ["prod", "staging"]),
            );
        });

        it("ignores duplicates", () => {
            expect(key(undefined, undefined, "7d", ["prod", "prod"])).toBe(
                key(undefined, undefined, "7d", ["prod"]),
            );
        });

        it("treats an empty environment filter as no filter", () => {
            expect(key(undefined, undefined, "7d", [])).toBe(
                key(undefined, undefined, "7d", undefined),
            );
        });
    });

    /**
     * Environment names arrive from the ingest API as free-form strings, so a
     * value can contain whatever a separator-joined key would have used as its
     * separator. Serialising instead of joining is what makes this hold.
     */
    describe("resists collisions from values containing separators", () => {
        it.each(["|", ",", ":", '"', "[", "]"])(
            "does not collide when a value contains %s",
            (char) => {
                expect(key(undefined, undefined, "7d", [`a${char}b`])).not.toBe(
                    key(undefined, undefined, "7d", ["a", "b"]),
                );
            },
        );

        it("does not let a project id impersonate two ids", () => {
            expect(key(undefined, ['p1","p2'])).not.toBe(
                key(undefined, ["p1", "p2"]),
            );
        });
    });

    describe("stability", () => {
        it("returns the same key for the same parts", () => {
            expect(key()).toBe(key());
        });

        it("does not mutate the arrays it is given", () => {
            const projectIds = ["p2", "p1"];
            const environments = ["staging", "prod"];
            key(undefined, projectIds, "7d", environments);

            expect(projectIds).toEqual(["p2", "p1"]);
            expect(environments).toEqual(["staging", "prod"]);
        });
    });
});
