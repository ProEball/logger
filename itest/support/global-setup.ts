import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { ITEST_ADMIN_URL, ITEST_DATABASE_URL, ITEST_DB_NAME } from "./env";
import { seedCorpus } from "./fixture";

/**
 * Brings `logger_itest` up from nothing: create, extend, migrate, seed.
 *
 * Everything here is idempotent, and the database is created in code rather
 * than by hand. That is a direct response to how the e2e database went: it was
 * created manually, `pg_partman` was missed because `db/init/01-extensions.sql`
 * only runs against the container's default database on first init, and
 * `drizzle-kit migrate` then failed silently behind its spinner. The cost of
 * that was an afternoon; the cost of these forty lines is forty lines.
 */

async function ensureDatabaseExists(): Promise<void> {
    const admin = postgres(ITEST_ADMIN_URL, { max: 1, onnotice: () => {} });
    try {
        const rows = await admin`SELECT 1 FROM pg_database WHERE datname = ${ITEST_DB_NAME}`;
        if (rows.length === 0) {
            // Postgres has no CREATE DATABASE IF NOT EXISTS, and the name is a
            // module constant rather than input, so interpolation is safe here.
            await admin.unsafe(`CREATE DATABASE ${ITEST_DB_NAME}`);
            console.log(`[itest] created database ${ITEST_DB_NAME}`);
        }
    } finally {
        await admin.end();
    }
}

export default async function setup(): Promise<void> {
    await ensureDatabaseExists();

    // Migrations are idempotent and emit "already exists" notices on every
    // re-run; they are noise, not information.
    const sql = postgres(ITEST_DATABASE_URL, { max: 1, onnotice: () => {} });
    try {
        // Migration 0003 calls public.create_parent(), so partman has to be
        // present in *this* database before migrating, not just in the cluster.
        await sql.unsafe("CREATE EXTENSION IF NOT EXISTS pg_partman");

        await migrate(drizzle(sql), { migrationsFolder: "./core/db/migrations" });

        await seedCorpus(sql);
    } catch (err) {
        console.error("[itest] setup failed:", err);
        throw err;
    } finally {
        await sql.end();
    }
}
