import { describe, it, expect, beforeEach, vi } from "vitest";

const { executeMock } = vi.hoisted(() => ({ executeMock: vi.fn() }));
vi.mock("@/core/db/client", () => ({ db: { execute: executeMock } }));

import { rollupBoundary } from "./rollup-boundary.service";

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const BOUNDARY = "2026-08-21T10:00:00.000Z";

beforeEach(() => {
    executeMock.mockReset();
});

/** One `rollup_state` aggregate row, as the query returns it. */
function stateRow(patch: { boundary?: string | null; missing?: number; present?: number }) {
    executeMock.mockResolvedValue([
        {
            // `??` would swallow an explicit null, which is one of the cases
            // under test.
            boundary: "boundary" in patch ? patch.boundary : BOUNDARY,
            missing: patch.missing ?? 0,
            present: patch.present ?? 1,
        },
    ]);
}

describe("rollupBoundary", () => {
    it("returns the watermark when every project has one", async () => {
        stateRow({ present: 2 });

        await expect(rollupBoundary([P1, P2])).resolves.toEqual(new Date(BOUNDARY));
    });

    it("asks the database nothing for an empty project list", async () => {
        await expect(rollupBoundary([])).resolves.toBeNull();
        expect(executeMock).not.toHaveBeenCalled();
    });

    /**
     * Every one of these means "read from raw `events` instead". The failure
     * being avoided is silent: a boundary that is too optimistic makes the read
     * union summary rows that were never written, which undercounts without
     * raising anything.
     */
    describe("refuses to guess", () => {
        it("is null when a project has a row but a NULL watermark", async () => {
            stateRow({ missing: 1, present: 2 });

            await expect(rollupBoundary([P1, P2])).resolves.toBeNull();
        });

        /**
         * The subtle one. `MIN` and the NULL filter both ignore rows that are
         * absent, so a project missing from `rollup_state` would silently
         * inherit the other projects' boundary and then contribute no rollup
         * rows below it.
         */
        it("is null when a project has no row at all", async () => {
            // Two projects asked for, one row found.
            stateRow({ present: 1 });

            await expect(rollupBoundary([P1, P2])).resolves.toBeNull();
        });

        it("is null when the aggregate returns no row", async () => {
            executeMock.mockResolvedValue([]);

            await expect(rollupBoundary([P1])).resolves.toBeNull();
        });

        it("is null when the watermark itself is NULL", async () => {
            stateRow({ boundary: null });

            await expect(rollupBoundary([P1])).resolves.toBeNull();
        });
    });

    /**
     * Removed 2026-08-21: "takes the minimum across projects, not any one of
     * them". The `MIN` happens in SQL, which is mocked here, so the test
     * asserted that a mocked value came back unchanged — already covered by the
     * first test in this file. An audit flagged it as tautological, and it was:
     * it could not have failed for any reason related to this module.
     *
     * The property it claimed to cover is real and is tested where the SQL
     * actually runs — `event-rollup.service.itest.ts`.
     */

    it("scopes the query to the projects it was given", async () => {
        stateRow({ present: 1 });
        await rollupBoundary([P1]);

        const issued = JSON.stringify(executeMock.mock.calls[0]?.[0]);
        expect(issued).toContain(P1);
        expect(issued).not.toContain(P2);
    });
});
