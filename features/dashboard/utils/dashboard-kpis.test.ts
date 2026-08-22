import { describe, it, expect } from "vitest";
import {
    errorCount,
    eventsPerMinuteRate,
    fatalCount,
    firingRules,
    sparklines,
} from "./dashboard-kpis";
import type { BucketRow } from "@/features/dashboard/utils/aggregation-utils";

function bucket(total: number, byLevel: Record<string, number> = {}): BucketRow {
    return { ts: new Date("2026-08-21T00:00:00Z"), total, byLevel };
}

describe("eventsPerMinuteRate", () => {
    it("divides the total by the preset's length in minutes", () => {
        // 120 events over an hour is 2 per minute.
        expect(eventsPerMinuteRate([bucket(60), bucket(60)], { type: "preset", value: "1h" })).toBe(
            "2",
        );
    });

    it("uses the preset's length, not the number of buckets", () => {
        // The same 120 events over 24 hours is 0.08/min, not 2.
        expect(
            eventsPerMinuteRate([bucket(60), bucket(60)], { type: "preset", value: "24h" }),
        ).toBe("0.08");
    });

    /**
     * The boundary that decides the format. A rate under 1 rounded to "0" reads
     * as "nothing is arriving" when the truth is "something is, slowly".
     */
    describe("formatting around a rate of 1", () => {
        it("shows two decimals below 1", () => {
            expect(eventsPerMinuteRate([bucket(30)], { type: "preset", value: "1h" })).toBe("0.50");
        });

        it("rounds at exactly 1", () => {
            expect(eventsPerMinuteRate([bucket(60)], { type: "preset", value: "1h" })).toBe("1");
        });

        it("rounds above 1", () => {
            expect(eventsPerMinuteRate([bucket(90)], { type: "preset", value: "1h" })).toBe("2");
        });

        it("reports 0.00 rather than 0 for an empty range", () => {
            expect(eventsPerMinuteRate([], { type: "preset", value: "1h" })).toBe("0.00");
        });
    });

    it("falls back to an hour for a custom range", () => {
        expect(
            eventsPerMinuteRate([bucket(120)], {
                type: "custom",
                from: "2026-08-20T00:00:00Z",
                to: "2026-08-21T00:00:00Z",
            }),
        ).toBe("2");
    });
});

describe("errorCount", () => {
    it("counts errors and fatals together", () => {
        expect(
            errorCount([
                { level: "error", count: 7 },
                { level: "fatal", count: 3 },
                { level: "warn", count: 100 },
                { level: "info", count: 100 },
            ]),
        ).toBe(10);
    });

    it("is 0 when nothing failed", () => {
        expect(errorCount([{ level: "info", count: 5 }])).toBe(0);
    });

    it("is 0 for an empty breakdown", () => {
        expect(errorCount([])).toBe(0);
    });
});

describe("fatalCount", () => {
    /**
     * The asymmetry with `errorCount` is the point: the two KPI cards sit side
     * by side, one counting both levels and one counting a single level, and a
     * reader who assumes they are the same function gets the "Fatal" card
     * wrong.
     */
    it("counts fatals only, unlike errorCount", () => {
        const levels = [
            { level: "error", count: 7 },
            { level: "fatal", count: 3 },
        ];

        expect(fatalCount(levels)).toBe(3);
        expect(errorCount(levels)).toBe(10);
    });

    it("is 0 when there are errors but no fatals", () => {
        expect(fatalCount([{ level: "error", count: 7 }])).toBe(0);
    });
});

describe("firingRules", () => {
    it("returns rules that are enabled and firing", () => {
        const rules = [
            { id: "a", enabled: true, state: "firing" },
            { id: "b", enabled: true, state: "ok" },
        ];

        expect(firingRules(rules).map((r) => r.id)).toEqual(["a"]);
    });

    /**
     * A disabled rule stuck in `firing` is switched off, not firing. Counting it
     * would light the KPI red for something nobody is watching.
     */
    it("excludes a disabled rule left in the firing state", () => {
        expect(firingRules([{ enabled: false, state: "firing" }])).toEqual([]);
    });

    it("excludes a rule with no state at all", () => {
        expect(firingRules([{ enabled: true, state: null }])).toEqual([]);
    });

    it("is empty for no rules", () => {
        expect(firingRules([])).toEqual([]);
    });
});

describe("sparklines", () => {
    it("keeps bucket order and pairs each series with its level", () => {
        const buckets = [
            bucket(10, { info: 8, error: 2 }),
            bucket(5, { fatal: 5 }),
        ];

        expect(sparklines(buckets)).toEqual({
            total: [10, 5],
            errors: [2, 5], // error + fatal
            fatal: [0, 5],
        });
    });

    it("reads a missing level as 0 rather than undefined", () => {
        // A gap in the array would break the sparkline's path, and `undefined`
        // renders as one.
        expect(sparklines([bucket(0)])).toEqual({ total: [0], errors: [0], fatal: [0] });
    });

    it("is empty for no buckets", () => {
        expect(sparklines([])).toEqual({ total: [], errors: [], fatal: [] });
    });
});
