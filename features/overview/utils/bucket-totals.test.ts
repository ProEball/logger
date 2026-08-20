import { describe, it, expect } from "vitest";
import { totalsByTimestamp } from "@/features/overview/utils/bucket-totals";
import type { OrgEventBucket } from "@/features/overview/services/overview.service";

function bucket(projectId: string, iso: string, count: number, errorCount = 0): OrgEventBucket {
    return { projectId, ts: new Date(iso), count, errorCount };
}

describe("totalsByTimestamp", () => {
    it("returns an empty series for no buckets", () => {
        expect(totalsByTimestamp([])).toEqual([]);
    });

    it("passes a single project's counts through in order", () => {
        expect(totalsByTimestamp([
            bucket("p1", "2026-08-20T10:00:00Z", 5),
            bucket("p1", "2026-08-20T11:00:00Z", 8),
        ])).toEqual([5, 8]);
    });

    it("sums across projects that share a timestamp", () => {
        expect(totalsByTimestamp([
            bucket("p1", "2026-08-20T10:00:00Z", 5),
            bucket("p2", "2026-08-20T10:00:00Z", 3),
        ])).toEqual([8]);
    });

    it("orders oldest first even when the rows arrive out of order", () => {
        // Rows are grouped by (project, ts), so a second project's series
        // starts over at an earlier timestamp than the first one ended at.
        expect(totalsByTimestamp([
            bucket("p1", "2026-08-20T11:00:00Z", 1),
            bucket("p2", "2026-08-20T10:00:00Z", 2),
        ])).toEqual([2, 1]);
    });

    it("treats two Date objects for the same instant as one bucket", () => {
        expect(totalsByTimestamp([
            bucket("p1", "2026-08-20T10:00:00.000Z", 4),
            bucket("p2", "2026-08-20T10:00:00Z", 6),
        ])).toEqual([10]);
    });

    it("leaves a gap as a gap - it does not zero-fill", () => {
        // The org chart has no fillBuckets() equivalent; a quiet hour produces
        // no row at all and the sparkline simply joins across it.
        expect(totalsByTimestamp([
            bucket("p1", "2026-08-20T10:00:00Z", 1),
            bucket("p1", "2026-08-20T13:00:00Z", 2),
        ])).toEqual([1, 2]);
    });

    it("ignores errorCount, which the sparkline does not plot", () => {
        expect(totalsByTimestamp([bucket("p1", "2026-08-20T10:00:00Z", 7, 7)])).toEqual([7]);
    });
});
