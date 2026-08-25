import { describe, it, expect } from "vitest";
import {
    errorCount,
    totalEvents,
    fatalCount,
    firingRules,
    sparklines,
} from "./dashboard-kpis";
import type { LevelledBucket } from "@/shared/utils/event-buckets";

function bucket(total: number, byLevel: Record<string, number> = {}): LevelledBucket {
    const errors = (byLevel.error ?? 0) + (byLevel.fatal ?? 0);
    return { projectId: "p", ts: new Date("2026-08-21T00:00:00Z"), total, errors, byLevel };
}

describe("totalEvents", () => {
    it("sums every bucket", () => {
        expect(totalEvents([bucket(60), bucket(40)])).toBe("100");
    });

    it("is zero for an empty series", () => {
        expect(totalEvents([])).toBe("0");
    });

    it("thousands-separates, matching the org KPI beside it", () => {
        // The two dashboards show the same number in the same place; a raw
        // 1234567 next to a formatted one is the kind of difference that makes
        // a reader wonder whether they are the same metric.
        expect(totalEvents([bucket(1_234_567)])).toBe((1234567).toLocaleString());
    });

    /**
     * It does **not** divide by the range. That was the previous KPI, and at 30
     * days it reported a month of traffic over 43,200 minutes — a number that
     * moved for reasons nobody could see. The live rate replaced it in the
     * application top bar; see `shared/utils/live-rate.ts`.
     */
    it("is the same number whatever the range", () => {
        const series = [bucket(60), bucket(60)];
        expect(totalEvents(series)).toBe("120");
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
