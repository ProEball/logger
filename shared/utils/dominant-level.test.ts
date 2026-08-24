import { describe, it, expect } from "vitest";
import { pickDominantLevel } from "./dominant-level";
import { EVENT_LEVELS } from "@/shared/utils/event-filters.schema";

const NONE = { debug: 0, info: 0, warn: 0, error: 0, fatal: 0 };

describe("pickDominantLevel", () => {
    it("returns the level that occurs most", () => {
        expect(pickDominantLevel({ ...NONE, info: 3, error: 7 })).toBe("error");
    });

    it("is not fooled by a more severe level occurring less often", () => {
        expect(pickDominantLevel({ ...NONE, info: 40, fatal: 1 })).toBe("info");
    });

    it("ignores levels absent from the counts entirely", () => {
        expect(pickDominantLevel({ warn: 2 })).toBe("warn");
    });

    describe("ties", () => {
        /**
         * `mode()` resolved these arbitrarily. A widget answering "what should I
         * look at" should resolve them toward the thing more worth looking at,
         * so the tie-break is an intentional behaviour change, not a port.
         */
        it("breaks a tie toward the more severe level", () => {
            expect(pickDominantLevel({ ...NONE, info: 5, error: 5 })).toBe("error");
        });

        it("breaks a three-way tie toward the most severe of them", () => {
            expect(pickDominantLevel({ ...NONE, debug: 4, warn: 4, error: 4 })).toBe("error");
        });

        it("prefers severity only on equality, never on near-equality", () => {
            expect(pickDominantLevel({ ...NONE, warn: 5, fatal: 4 })).toBe("warn");
        });
    });

    describe("edges", () => {
        it("handles a single event", () => {
            expect(pickDominantLevel({ ...NONE, debug: 1 })).toBe("debug");
        });

        /**
         * Unreachable through the query — GROUP BY only emits a row because it
         * found events — so this asserts the invariant rather than a path. It
         * throws rather than defaulting because the tie-break would otherwise
         * return "fatal" for an empty group, which is the worst wrong answer
         * available.
         */
        it("throws when nothing has a positive count", () => {
            expect(() => pickDominantLevel(NONE)).toThrow(/no level has a positive count/);
            expect(() => pickDominantLevel({})).toThrow();
        });

        it("rejects negative counts by treating them as absent", () => {
            // Not a real input, but the guard must not let one win a comparison.
            expect(pickDominantLevel({ ...NONE, info: -5, warn: 1 })).toBe("warn");
        });
    });

    /**
     * Asserts the derivation, not the contents: adding a level to EVENT_LEVELS
     * must not leave this function quietly unable to return it.
     */
    it("can return every level the schema defines", () => {
        for (const level of EVENT_LEVELS) {
            expect(pickDominantLevel({ [level]: 1 })).toBe(level);
        }
    });
});
