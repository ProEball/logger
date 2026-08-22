import { describe, it, expect } from "vitest";
import {
    buildProjectRows,
    sumProjectRows,
    type AlertRuleFlags,
    type OverviewProject,
} from "@/features/overview/utils/build-project-rows";
import type { ProjectStats } from "@/features/overview/services/overview.service";

const alpha: OverviewProject = { id: "p1", slug: "alpha", name: "Alpha" };
const beta: OverviewProject = { id: "p2", slug: "beta", name: "Beta" };

function stats(patch: Partial<ProjectStats> & { projectId: string }): ProjectStats {
    return {
        totalEvents: 0,
        errorCount: 0,
        environments: [],
        ...patch,
    };
}

function rule(enabled: boolean, state: string | null): AlertRuleFlags {
    return { enabled, state };
}

describe("buildProjectRows", () => {
    it("returns no rows for no projects", () => {
        expect(buildProjectRows([], new Map(), new Map())).toEqual([]);
    });

    it("keeps a project with no events, showing zeros instead of dropping it", () => {
        // A quiet project disappearing from the overview reads as "deleted".
        const [row] = buildProjectRows([alpha], new Map(), new Map());
        expect(row.project.slug).toBe("alpha");
        expect(row.totalEvents).toBe(0);
        expect(row.errorCount).toBe(0);
        expect(row.environments).toEqual([]);
    });

    /**
     * The top message left `ProjectRow` on 2026-08-20 — it arrives on its own
     * promise and renders into a per-row `Suspense` boundary, because that
     * query costs ~954 ms against ~30 ms for everything here. A row carrying it
     * again would mean the split had been undone.
     */
    it("carries no message fields", () => {
        const [row] = buildProjectRows([alpha], new Map(), new Map());
        expect(row).not.toHaveProperty("topMessage");
        expect(row).not.toHaveProperty("topMessageLevel");
    });

    it("maps a project's statistics onto its row", () => {
        const byProject = new Map([
            ["p1", stats({
                projectId: "p1",
                totalEvents: 120,
                errorCount: 7,
                environments: ["production", "staging"],
            })],
        ]);
        const [row] = buildProjectRows([alpha], byProject, new Map());
        expect(row.totalEvents).toBe(120);
        expect(row.errorCount).toBe(7);
        expect(row.environments).toEqual(["production", "staging"]);
    });

    it("preserves the order of the project list", () => {
        const rows = buildProjectRows([beta, alpha], new Map(), new Map());
        expect(rows.map((r) => r.project.slug)).toEqual(["beta", "alpha"]);
    });

    it("ignores a summary for a project that is not in the list", () => {
        const byProject = new Map([["p2", stats({ projectId: "p2", totalEvents: 999 })]]);
        const rows = buildProjectRows([alpha], byProject, new Map());
        expect(rows).toHaveLength(1);
        expect(rows[0].totalEvents).toBe(0);
    });

    it("counts only rules that are both enabled and firing", () => {
        const rules = new Map([["p1", [
            rule(true, "firing"),
            rule(true, "ok"),
            rule(false, "firing"),
            rule(true, null),
        ]]]);
        const [row] = buildProjectRows([alpha], new Map(), rules);
        expect(row.firingAlertsCount).toBe(1);
    });

    it("counts every enabled rule, firing or not", () => {
        const rules = new Map([["p1", [rule(true, "ok"), rule(true, "firing"), rule(false, "ok")]]]);
        const [row] = buildProjectRows([alpha], new Map(), rules);
        expect(row.enabledAlertsCount).toBe(2);
    });

    it("does not count a disabled rule left in the firing state", () => {
        // Disabling a firing rule does not reset its state column, so this is
        // a real row shape, not a hypothetical one.
        const rules = new Map([["p1", [rule(false, "firing")]]]);
        const [row] = buildProjectRows([alpha], new Map(), rules);
        expect(row.firingAlertsCount).toBe(0);
        expect(row.enabledAlertsCount).toBe(0);
    });

    it("reports zero alerts for a project with no rules at all", () => {
        const [row] = buildProjectRows([alpha], new Map(), new Map());
        expect(row.firingAlertsCount).toBe(0);
        expect(row.enabledAlertsCount).toBe(0);
    });

    it("keeps each project's alerts separate", () => {
        const rules = new Map([
            ["p1", [rule(true, "firing")]],
            ["p2", [rule(true, "ok"), rule(true, "ok")]],
        ]);
        const rows = buildProjectRows([alpha, beta], new Map(), rules);
        expect(rows[0].firingAlertsCount).toBe(1);
        expect(rows[1].firingAlertsCount).toBe(0);
        expect(rows[1].enabledAlertsCount).toBe(2);
    });
});

describe("sumProjectRows", () => {
    it("returns zeros for no rows", () => {
        expect(sumProjectRows([])).toEqual({
            totalEvents: 0,
            totalErrors: 0,
            firingAlerts: 0,
            enabledAlerts: 0,
        });
    });

    it("adds every row's counts together", () => {
        const byProject = new Map([
            ["p1", stats({ projectId: "p1", totalEvents: 100, errorCount: 3 })],
            ["p2", stats({ projectId: "p2", totalEvents: 5, errorCount: 5 })],
        ]);
        const rules = new Map([
            ["p1", [rule(true, "firing"), rule(true, "ok")]],
            ["p2", [rule(true, "firing"), rule(false, "firing")]],
        ]);
        expect(sumProjectRows(buildProjectRows([alpha, beta], byProject, rules))).toEqual({
            totalEvents: 105,
            totalErrors: 8,
            firingAlerts: 2,
            enabledAlerts: 3,
        });
    });

    it("counts a project with zero events without skipping it", () => {
        const rows = buildProjectRows([alpha, beta], new Map(), new Map());
        expect(rows).toHaveLength(2);
        expect(sumProjectRows(rows).totalEvents).toBe(0);
    });
});
