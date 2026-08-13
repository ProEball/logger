import type postgres from "postgres";
import journal from "@/core/db/migrations/meta/_journal.json";

type PgSql = ReturnType<typeof postgres>;

export type MigrationStatus = {
    applied: number;
    expected: number;
    isUpToDate: boolean;
};

/** Migrations present in the build — the number the database should match. */
export const EXPECTED_MIGRATION_COUNT = journal.entries.length;

/**
 * Compares migrations applied to the database against migrations shipped in
 * this build. Throws if the table cannot be read at all (no database, or
 * migrations have never been run against it).
 */
export async function getMigrationStatus(client: PgSql): Promise<MigrationStatus> {
    // The `drizzle.` schema qualifier is the whole point. Both drizzle-kit and
    // drizzle-orm's migrator write this table into the `drizzle` schema, never
    // `public`. Querying it unqualified raised "relation does not exist" on
    // every call — which the readiness route caught and reported as
    // `migrations: "unavailable"`, so the check silently never ran and an app
    // pointed at a half-migrated database still passed its healthcheck.
    const [row] = await client`SELECT COUNT(*)::int AS cnt FROM drizzle."__drizzle_migrations"`;
    const applied = Number(row.cnt);

    return {
        applied,
        expected: EXPECTED_MIGRATION_COUNT,
        // Deliberately `>=`, not `===`: an app rolled back one version runs
        // against a database migrated by its successor, which is expected
        // during a staged deploy and is not a readiness failure. Fewer applied
        // than expected is, because this build's queries reference columns that
        // are not there yet.
        isUpToDate: applied >= EXPECTED_MIGRATION_COUNT,
    };
}
