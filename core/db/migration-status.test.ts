import { describe, it, expect, vi } from "vitest";
import type postgres from "postgres";
import { getMigrationStatus, EXPECTED_MIGRATION_COUNT } from "./migration-status";

type PgSql = ReturnType<typeof postgres>;

/** Minimal stand-in for the postgres.js tagged-template client. */
function fakeClient(rows: unknown[] | (() => never)): {
    client: PgSql;
    queries: string[];
} {
    const queries: string[] = [];
    const client = ((strings: TemplateStringsArray) => {
        queries.push(Array.from(strings).join("?"));
        if (typeof rows === "function") return Promise.reject(new Error("relation does not exist"));
        return Promise.resolve(rows);
    }) as unknown as PgSql;
    return { client, queries };
}

describe("getMigrationStatus", () => {
    it("reads the migrations table from the drizzle schema, not public", async () => {
        // Regression: the readiness route queried an unqualified
        // "__drizzle_migrations", which resolves to public and does not exist.
        const { client, queries } = fakeClient([{ cnt: EXPECTED_MIGRATION_COUNT }]);

        await getMigrationStatus(client);

        expect(queries[0]).toContain('drizzle."__drizzle_migrations"');
    });

    it("reports up to date when the counts match", async () => {
        const { client } = fakeClient([{ cnt: EXPECTED_MIGRATION_COUNT }]);

        await expect(getMigrationStatus(client)).resolves.toEqual({
            applied: EXPECTED_MIGRATION_COUNT,
            expected: EXPECTED_MIGRATION_COUNT,
            isUpToDate: true,
        });
    });

    it("reports behind when the database has fewer migrations than the build", async () => {
        const { client } = fakeClient([{ cnt: EXPECTED_MIGRATION_COUNT - 1 }]);

        const status = await getMigrationStatus(client);

        expect(status.applied).toBe(EXPECTED_MIGRATION_COUNT - 1);
        expect(status.isUpToDate).toBe(false);
    });

    it("reports behind for a database that has never been migrated", async () => {
        const { client } = fakeClient([{ cnt: 0 }]);

        await expect(getMigrationStatus(client)).resolves.toMatchObject({
            applied: 0,
            isUpToDate: false,
        });
    });

    it("accepts a database migrated further ahead than this build", async () => {
        // A rolled-back app runs against its successor's schema during a staged
        // deploy. That is expected, not a readiness failure.
        const { client } = fakeClient([{ cnt: EXPECTED_MIGRATION_COUNT + 1 }]);

        await expect(getMigrationStatus(client)).resolves.toMatchObject({
            isUpToDate: true,
        });
    });

    it("coerces a string count, since postgres returns bigint as text", async () => {
        const { client } = fakeClient([{ cnt: String(EXPECTED_MIGRATION_COUNT) }]);

        await expect(getMigrationStatus(client)).resolves.toMatchObject({
            applied: EXPECTED_MIGRATION_COUNT,
            isUpToDate: true,
        });
    });

    it("propagates a failure to read the table at all", async () => {
        const { client } = fakeClient(() => {
            throw new Error("unreachable");
        });

        await expect(getMigrationStatus(client)).rejects.toThrow();
    });

    it("expects at least one migration — a zero baseline would pass anything", async () => {
        expect(EXPECTED_MIGRATION_COUNT).toBeGreaterThan(0);
    });
});

vi.mock("@/core/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));
