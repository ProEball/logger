import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

import { db } from "@/core/db/client";
import { templateHashForStorage } from "@/features/ingest/utils/normalize-message";
import { rebuildRollupForProject } from "@/features/ingest/services/event-rollup.service";
import { ORG_A } from "@/itest/support/fixture";

import { rollupBoundary, templateCoverageForProjects } from "./rollup-boundary.service";

/**
 * What an **event-free project** does to an organization's coverage.
 *
 * Discovered on staging 2026-08-24, and it had been live since the project was
 * created. `rollup_state` rows are written by `markRollupDirty`, which ingest
 * calls — so a project that has never received an event has no row, and both
 * boundary functions answered "read raw `events`" for the *entire*
 * organization. The org overview had therefore never once used the template
 * rollup that `a1bdfda` built for it.
 *
 * The guard was not wrong. It refuses to let a project missing from
 * `rollup_state` inherit the others' watermark and then contribute no summary
 * rows below it, which undercounts silently. What it got wrong is *which*
 * missing rows are dangerous: a project with no events contributes nothing to
 * the rollup **and** nothing to raw `events`, so it cannot undercount anything.
 *
 * Hence the split every test here turns on — **no row and no events** is
 * harmless, **no row but events exist** is the real hazard and must still force
 * the fallback.
 *
 * An integration test rather than a unit test because the whole change is in
 * SQL: the query-builder mock in `rollup-boundary.service.test.ts` can assert
 * what the function does with a row, never whether Postgres produces that row.
 * Writes, so it owns its projects instead of touching the shared fixture.
 */

/** Has events and a rollup. The only project that should set the watermark. */
const ACTIVE = randomUUID();
/** No events, no `rollup_state` row — the shape found on staging. */
const EMPTY_NO_ROW = randomUUID();
/** No events, but a row with NULL watermarks — what migration 0008 seeded. */
const EMPTY_WITH_ROW = randomUUID();
/** Has events and no row. The hazard the guard exists for. */
const UNROLLED = randomUUID();
/**
 * Has events and a template *ceiling* but no floor — a state the job cannot
 * produce, written here directly on purpose. See the test that uses it.
 */
const HALF_ROLLED = randomUUID();

const ANCHOR = new Date(Math.floor((Date.now() - 60 * 60_000) / 60_000) * 60_000);

function at(offsetMinutes: number): Date {
    return new Date(ANCHOR.getTime() + offsetMinutes * 60_000);
}

async function createProject(id: string, label: string): Promise<void> {
    await db.execute(sql`
        INSERT INTO projects (id, organization_id, name, slug)
        VALUES (${id}::uuid, ${ORG_A}::uuid, ${label}, ${`${label}-${id.slice(0, 8)}`})
    `);
}

async function insertEvent(projectId: string, offsetMinutes: number, message: string): Promise<void> {
    await db.execute(sql`
        INSERT INTO events (id, project_id, timestamp, level, message, template_hash)
        VALUES (
            ${randomUUID()}::uuid, ${projectId}::uuid, ${at(offsetMinutes).toISOString()}::timestamptz,
            'info', ${message}, ${templateHashForStorage(message).toString()}::bigint
        )
    `);
}

/** Rebuild until caught up, as the job does across runs. */
async function rebuildFully(projectId: string): Promise<void> {
    for (let i = 0; i < 40; i++) {
        const [state] = await db.execute<{ refresh_from: Date }>(sql`
            SELECT refresh_from FROM rollup_state WHERE project_id = ${projectId}::uuid
        `);
        const result = await rebuildRollupForProject(projectId, new Date(state.refresh_from));
        if (!result.hasMore) return;
    }
    throw new Error("rollup did not catch up within 40 runs");
}

beforeAll(async () => {
    await createProject(ACTIVE, "bnd-active");
    await createProject(EMPTY_NO_ROW, "bnd-empty-norow");
    await createProject(EMPTY_WITH_ROW, "bnd-empty-withrow");
    await createProject(UNROLLED, "bnd-unrolled");
    await createProject(HALF_ROLLED, "bnd-half-rolled");

    // ACTIVE: events plus a real rollup, the way ingest then the job produce one.
    await db.execute(sql`
        INSERT INTO rollup_state (project_id, refresh_from)
        VALUES (${ACTIVE}::uuid, ${ANCHOR.toISOString()}::timestamptz)
    `);
    await insertEvent(ACTIVE, 0, "Session sess_a1 expired");
    await insertEvent(ACTIVE, 1, "Session sess_b2 expired");
    await rebuildFully(ACTIVE);

    // EMPTY_WITH_ROW: exactly what migration 0008 wrote for a project that had
    // no events — a row whose watermarks are still NULL because the job has
    // never had a reason to touch it.
    await db.execute(sql`
        INSERT INTO rollup_state (project_id, refresh_from)
        VALUES (${EMPTY_WITH_ROW}::uuid, ${ANCHOR.toISOString()}::timestamptz)
    `);

    // UNROLLED: events, deliberately no rollup_state row.
    await insertEvent(UNROLLED, 0, "Unrolled event");

    // HALF_ROLLED: events, a template ceiling, and no floor. The job writes
    // both columns in one statement so this cannot arise from it — which is
    // exactly why it is written by hand. It stands for any future path that
    // sets one end without the other, and it is the shape the pre-2026-08-24
    // filter (which looked only at `templates_rolled_up_to`) would have let
    // through.
    await insertEvent(HALF_ROLLED, 0, "Half rolled event");
    await db.execute(sql`
        INSERT INTO rollup_state (project_id, refresh_from, templates_rolled_up_to)
        VALUES (${HALF_ROLLED}::uuid, ${ANCHOR.toISOString()}::timestamptz,
                ${at(5).toISOString()}::timestamptz)
    `);
});

afterAll(async () => {
    const ids = [ACTIVE, EMPTY_NO_ROW, EMPTY_WITH_ROW, UNROLLED, HALF_ROLLED];
    for (const id of ids) {
        // events.project_id is ON DELETE RESTRICT; rollup rows cascade with the project.
        await db.execute(sql`DELETE FROM events WHERE project_id = ${id}::uuid`);
        await db.execute(sql`DELETE FROM projects WHERE id = ${id}::uuid`);
    }
});

/** Sanity: the fixture really is in the state every assertion below assumes. */
describe("fixture", () => {
    it("gave the active project a watermark and left the empty ones without one", async () => {
        const rows = await db.execute<{ project_id: string; rolled_up_to: Date | null }>(sql`
            SELECT project_id, rolled_up_to FROM rollup_state
            WHERE project_id = ANY(ARRAY[${ACTIVE}::uuid, ${EMPTY_NO_ROW}::uuid,
                                         ${EMPTY_WITH_ROW}::uuid, ${UNROLLED}::uuid])
        `);
        const byId = new Map(rows.map((r) => [r.project_id, r.rolled_up_to]));

        expect(byId.get(ACTIVE)).not.toBeNull();
        expect(byId.has(EMPTY_NO_ROW)).toBe(false);
        expect(byId.get(EMPTY_WITH_ROW)).toBeNull();
        expect(byId.has(UNROLLED)).toBe(false);
    });
});

describe("rollupBoundary", () => {
    it("still answers for one healthy project on its own", async () => {
        await expect(rollupBoundary([ACTIVE])).resolves.toBeInstanceOf(Date);
    });

    /** The staging bug, in one assertion. */
    it("is not blocked by a project that has no events and no row", async () => {
        await expect(rollupBoundary([ACTIVE, EMPTY_NO_ROW])).resolves.toBeInstanceOf(Date);
    });

    it("is not blocked by an event-free project whose row has a NULL watermark", async () => {
        await expect(rollupBoundary([ACTIVE, EMPTY_WITH_ROW])).resolves.toBeInstanceOf(Date);
    });

    it("ignores event-free projects when taking the minimum", async () => {
        const alone = await rollupBoundary([ACTIVE]);
        const withEmpties = await rollupBoundary([ACTIVE, EMPTY_NO_ROW, EMPTY_WITH_ROW]);

        // A project that contributes no rows must not move the watermark either.
        expect(withEmpties).toEqual(alone);
    });

    describe("still refuses when a project could actually undercount", () => {
        it("is null when a project has events but no rollup_state row", async () => {
            await expect(rollupBoundary([ACTIVE, UNROLLED])).resolves.toBeNull();
        });

        it("is null when every project is event-free", async () => {
            await expect(rollupBoundary([EMPTY_NO_ROW, EMPTY_WITH_ROW])).resolves.toBeNull();
        });

        it("asks nothing for an empty project list", async () => {
            await expect(rollupBoundary([])).resolves.toBeNull();
        });
    });
});

describe("templateCoverageForProjects", () => {
    it("still answers for one healthy project on its own", async () => {
        await expect(templateCoverageForProjects([ACTIVE])).resolves.not.toBeNull();
    });

    /** The same bug, on the path the org overview's top-message widget takes. */
    it("is not blocked by a project that has no events and no row", async () => {
        await expect(templateCoverageForProjects([ACTIVE, EMPTY_NO_ROW])).resolves.not.toBeNull();
    });

    it("is not blocked by an event-free project whose row has a NULL watermark", async () => {
        await expect(templateCoverageForProjects([ACTIVE, EMPTY_WITH_ROW])).resolves.not.toBeNull();
    });

    it("reports the same interval with and without the event-free projects", async () => {
        const alone = await templateCoverageForProjects([ACTIVE]);
        const withEmpties = await templateCoverageForProjects([ACTIVE, EMPTY_NO_ROW, EMPTY_WITH_ROW]);

        expect(withEmpties).toEqual(alone);
    });

    describe("still refuses when a project could actually undercount", () => {
        it("is null when a project has events but no rollup_state row", async () => {
            await expect(templateCoverageForProjects([ACTIVE, UNROLLED])).resolves.toBeNull();
        });

        it("is null when every project is event-free", async () => {
            await expect(
                templateCoverageForProjects([EMPTY_NO_ROW, EMPTY_WITH_ROW]),
            ).resolves.toBeNull();
        });

        /**
         * The floor inherits exactly as the ceiling does. `MAX` ignores NULLs,
         * so a project with a ceiling and no floor would have been handed
         * `ACTIVE`'s floor and declared covered from a moment it was never
         * summarised — the same inheritance bug this file is about, one column
         * over. Unreachable through the job, which writes both ends together;
         * that is a second mechanism holding this one correct, and relying on
         * one of those is what produced the bug in the first place.
         */
        it("is null when a project has a template ceiling but no floor", async () => {
            await expect(templateCoverageForProjects([ACTIVE, HALF_ROLLED])).resolves.toBeNull();
        });

        it("asks nothing for an empty project list", async () => {
            await expect(templateCoverageForProjects([])).resolves.toBeNull();
        });
    });
});
