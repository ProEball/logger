/**
 * Entrypoint for the one-shot `migrate` container.
 *
 * Bundled to `migrate.js` by `scripts/build-worker.mjs` and run as
 * `node migrate.js` — see `Dockerfile`. Exits 0 when the database is up to
 * date and non-zero otherwise; compose gates `app` and `worker` on that exit
 * code via `condition: service_completed_successfully`.
 *
 * Uses drizzle-orm's migrator rather than `drizzle-kit migrate` so the runtime
 * image needs no dev dependencies: drizzle-kit pulls in its own esbuild and a
 * bundled TypeScript, and reads `drizzle.config.ts`, which in turn wants
 * `dotenv` and a `.env.local` that does not exist in a container. Both read the
 * same journal and write the same `drizzle.__drizzle_migrations` table, so the
 * two are interchangeable against an existing database.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { env } from "@/core/env";
import { logger } from "@/core/logger";

/** Overridden in the image, where migrations are copied next to the bundle. */
const MIGRATIONS_DIR = process.env.MIGRATIONS_DIR ?? "core/db/migrations";

async function main(): Promise<void> {
    // A dedicated single connection, not the pooled `core/db/client` singleton:
    // migrations run one at a time and the process exits straight afterwards,
    // so a pool of 10 would just leave nine idle connections to time out.
    const client = postgres(env.DATABASE_URL, { max: 1 });

    try {
        logger.info({ migrationsFolder: MIGRATIONS_DIR }, "applying migrations");
        await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_DIR });
        logger.info("migrations applied");
    } finally {
        await client.end();
    }
}

main().catch((err) => {
    logger.fatal({ err }, "migrations failed");
    process.exit(1);
});
