import { describe, it, expect } from "vitest";
import { planBackfill } from "./plan-backfill";
import { templateHashForStorage, NORMALIZER_VERSION } from "./normalize-message";

const AT = new Date("2026-08-20T10:00:00.000Z");
const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";

function row(patch: Partial<Parameters<typeof planBackfill>[0][number]> = {}) {
    return { id: "e1", timestamp: AT, message: "User u_487 signed in", projectId: P1, ...patch };
}

describe("planBackfill", () => {
    it("produces one hash update per row", () => {
        const { updates } = planBackfill([row({ id: "a" }), row({ id: "b" }), row({ id: "c" })]);
        expect(updates.map((u) => u.id)).toEqual(["a", "b", "c"]);
    });

    /**
     * The property the whole backfill rests on. A hash computed here that
     * disagreed with the one ingest computes would split every backfilled
     * template away from its live counterpart, and the two would never be
     * summed together again — an undercount that no test of either side alone
     * could see.
     */
    it("computes the same hash ingest does", () => {
        const { updates } = planBackfill([row()]);
        expect(updates[0].templateHash).toBe(templateHashForStorage("User u_487 signed in"));
    });

    it("carries the composite key both halves, since events is partitioned", () => {
        const { updates } = planBackfill([row({ id: "x", timestamp: AT })]);
        expect(updates[0]).toEqual({ id: "x", timestamp: AT, templateHash: expect.anything() });
    });

    describe("template registry rows", () => {
        it("emits one per distinct shape, not one per event", () => {
            const { templates } = planBackfill([
                row({ id: "a", message: "User u_1 signed in" }),
                row({ id: "b", message: "User u_2 signed in" }),
                row({ id: "c", message: "User u_3 signed in" }),
            ]);

            expect(templates).toHaveLength(1);
            expect(templates[0].template).toBe("User *** signed in");
        });

        it("keeps two projects apart even for an identical shape", () => {
            // `message_templates` is keyed per project, so the same template
            // needs a row in each — the hash alone is not the key.
            const { templates } = planBackfill([
                row({ id: "a", projectId: P1 }),
                row({ id: "b", projectId: P2 }),
            ]);

            expect(templates).toHaveLength(2);
            expect(templates.map((t) => t.projectId).sort()).toEqual([P1, P2].sort());
        });

        it("stamps the normaliser version, so generations stay distinguishable", () => {
            const { templates } = planBackfill([row()]);
            expect(templates[0].normalizerVersion).toBe(NORMALIZER_VERSION);
        });

        it("separates genuinely different shapes", () => {
            const { templates } = planBackfill([
                row({ id: "a", message: "User u_1 signed in" }),
                row({ id: "b", message: "Session sess_x1y2 expired" }),
            ]);
            expect(templates).toHaveLength(2);
        });
    });

    it("returns nothing for an empty batch", () => {
        expect(planBackfill([])).toEqual({ updates: [], templates: [] });
    });
});
