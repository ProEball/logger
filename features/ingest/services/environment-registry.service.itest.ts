import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/core/db/client";
import { recordEnvironments } from "@/features/ingest/services/environment-registry.service";
import { getOrgEnvironments } from "@/features/overview/services/overview.service";
import { ORG_A } from "@/itest/support/fixture";

/**
 * The environment registry, end to end against Postgres.
 *
 * Mocking cannot reach what matters here: `UNIQUE ... NULLS NOT DISTINCT`,
 * `ON CONFLICT DO UPDATE` and the `setWhere` guard are database behaviour, and
 * the first of them exists precisely because Postgres's *default* treatment of
 * NULL in a unique constraint would be wrong for this table.
 *
 * This file writes, unlike the rest of the suite — so it creates its own
 * project and drops it again, rather than touching the shared fixture.
 */

const projectId = randomUUID();

async function rowsFor(): Promise<Array<{ environment: string | null; last_seen_at: Date }>> {
    return db.execute<{ environment: string | null; last_seen_at: Date }>(sql`
        SELECT environment, last_seen_at
        FROM project_environments
        WHERE project_id = ${projectId}::uuid
        ORDER BY environment
    `);
}

beforeAll(async () => {
    await db.execute(sql`
        INSERT INTO projects (id, organization_id, name, slug)
        VALUES (${projectId}::uuid, ${ORG_A}::uuid, 'Registry Test', ${`registry-${projectId.slice(0, 8)}`})
    `);
});

afterAll(async () => {
    // The FK cascades, so this clears the registry rows too.
    await db.execute(sql`DELETE FROM projects WHERE id = ${projectId}::uuid`);
});

describe("recordEnvironments", () => {
    it("does nothing for an empty batch", async () => {
        await recordEnvironments([], projectId);
        expect(await rowsFor()).toEqual([]);
    });

    it("records each distinct environment once", async () => {
        await recordEnvironments(
            [
                { environment: "production" },
                { environment: "production" },
                { environment: "staging" },
            ],
            projectId,
        );
        expect((await rowsFor()).map((r) => r.environment)).toEqual(["production", "staging"]);
    });

    it("is idempotent across calls", async () => {
        await recordEnvironments([{ environment: "production" }], projectId);
        await recordEnvironments([{ environment: "production" }], projectId);
        expect((await rowsFor()).filter((r) => r.environment === "production")).toHaveLength(1);
    });

    it("stores an absent environment as a single NULL row", async () => {
        // This is what UNIQUE ... NULLS NOT DISTINCT buys. Under Postgres's
        // default, every NULL is distinct from every other, and these two calls
        // would leave two rows — growing by one per ingest request forever.
        await recordEnvironments([{ environment: null }], projectId);
        await recordEnvironments([{}], projectId);
        expect((await rowsFor()).filter((r) => r.environment === null)).toHaveLength(1);
    });

    it("refreshes last_seen_at once the stored value is stale", async () => {
        await db.execute(sql`
            UPDATE project_environments
            SET last_seen_at = now() - interval '2 hours'
            WHERE project_id = ${projectId}::uuid AND environment = 'production'
        `);

        await recordEnvironments([{ environment: "production" }], projectId);

        const [row] = (await rowsFor()).filter((r) => r.environment === "production");
        expect(Date.now() - new Date(row.last_seen_at).getTime()).toBeLessThan(60_000);
    });

    it("does not rewrite a row it just wrote", async () => {
        // The `setWhere` guard: without it every ingest request updates every
        // row it touches, producing a dead tuple per batch for a column that is
        // only ever read against a 30-day window.
        await recordEnvironments([{ environment: "production" }], projectId);
        const [before] = (await rowsFor()).filter((r) => r.environment === "production");

        await recordEnvironments([{ environment: "production" }], projectId);
        const [after] = (await rowsFor()).filter((r) => r.environment === "production");

        expect(new Date(after.last_seen_at).getTime()).toBe(new Date(before.last_seen_at).getTime());
    });

    it("keeps environments separate per project", async () => {
        const other = randomUUID();
        await db.execute(sql`
            INSERT INTO projects (id, organization_id, name, slug)
            VALUES (${other}::uuid, ${ORG_A}::uuid, 'Other Registry', ${`other-${other.slice(0, 8)}`})
        `);
        try {
            await recordEnvironments([{ environment: "isolated" }], other);
            expect((await rowsFor()).map((r) => r.environment)).not.toContain("isolated");
        } finally {
            await db.execute(sql`DELETE FROM projects WHERE id = ${other}::uuid`);
        }
    });
});

describe("getOrgEnvironments reads the registry, not events", () => {
    it("offers an environment that has a registry row but no events", async () => {
        // The whole point of the change: the dropdown no longer scans `events`.
        // This project has never had a single event inserted.
        await recordEnvironments([{ environment: "registry-only" }], projectId);
        expect(await getOrgEnvironments([projectId])).toContain("registry-only");
    });

    it("labels the NULL row '(unset)', as the events scan used to", async () => {
        await recordEnvironments([{ environment: null }], projectId);
        expect(await getOrgEnvironments([projectId])).toContain("(unset)");
    });

    it("drops an environment whose last_seen_at is older than 30 days", async () => {
        await recordEnvironments([{ environment: "decommissioned" }], projectId);
        await db.execute(sql`
            UPDATE project_environments
            SET last_seen_at = now() - interval '31 days'
            WHERE project_id = ${projectId}::uuid AND environment = 'decommissioned'
        `);
        expect(await getOrgEnvironments([projectId])).not.toContain("decommissioned");
    });

    it("keeps one just inside the 30-day window", async () => {
        await recordEnvironments([{ environment: "barely-alive" }], projectId);
        await db.execute(sql`
            UPDATE project_environments
            SET last_seen_at = now() - interval '29 days'
            WHERE project_id = ${projectId}::uuid AND environment = 'barely-alive'
        `);
        expect(await getOrgEnvironments([projectId])).toContain("barely-alive");
    });
});
