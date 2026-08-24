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

/**
 * One aggregate row, as the query returns it since 2026-08-24.
 *
 * `blocking` counts projects that **have events** and no usable watermark —
 * the only ones that can undercount. `usable` counts projects contributing a
 * watermark. An event-free project appears in neither, which is the fix.
 *
 * Note what this file can and cannot reach. Deciding *which* projects land in
 * `blocking` is done in SQL — an `EXISTS` against `events` — so with the
 * database mocked, no test here can tell an event-free project from an
 * un-rolled-up one. That distinction is the entire bug, and it is covered where
 * the SQL actually runs: `rollup-boundary.service.itest.ts`. What is left here
 * is the branch logic given a row, which is worth keeping and is all this is.
 */
function stateRow(patch: { boundary?: string | null; blocking?: number; usable?: number }) {
    executeMock.mockResolvedValue([
        {
            // `??` would swallow an explicit null, which is one of the cases
            // under test.
            boundary: "boundary" in patch ? patch.boundary : BOUNDARY,
            blocking: patch.blocking ?? 0,
            usable: patch.usable ?? 1,
        },
    ]);
}

describe("rollupBoundary", () => {
    it("returns the watermark when nothing is blocking", async () => {
        stateRow({ usable: 2 });

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
        it("is null when a project with events lacks a usable watermark", async () => {
            stateRow({ blocking: 1, usable: 1 });

            await expect(rollupBoundary([P1, P2])).resolves.toBeNull();
        });

        /**
         * Nothing in scope has been rolled up — every project is event-free, or
         * the job has not run yet. Not an error, and not a boundary either.
         */
        it("is null when no project contributes a watermark", async () => {
            stateRow({ usable: 0, boundary: null });

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
     * Blocking is checked before usable: an organization holding one healthy
     * project and one that has events but was never rolled up must fall back,
     * not answer from the healthy one.
     */
    it("lets a blocking project override projects that do have watermarks", async () => {
        stateRow({ blocking: 1, usable: 5 });

        await expect(rollupBoundary([P1, P2])).resolves.toBeNull();
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
        stateRow({ usable: 1 });
        await rollupBoundary([P1]);

        const issued = JSON.stringify(executeMock.mock.calls[0]?.[0]);
        expect(issued).toContain(P1);
        expect(issued).not.toContain(P2);
    });
});
