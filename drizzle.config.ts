import type { Config } from "drizzle-kit";
import { config } from "dotenv";

config({ path: ".env.local" });

/**
 * Kept for `drizzle-kit studio` and for `drizzle-kit export`, which
 * `scripts/build-schema.mjs` runs to produce `db/schema.sql`.
 *
 * There is no `out` directory any more: the migration chain was deleted on
 * 2026-08-26 (see core/db/bootstrap.ts). `generate`, `migrate` and `push` are
 * deliberately not wired to npm scripts — the schema is built from empty by
 * the bootstrap, and a second path that creates tables would drift from it.
 */
export default {
    schema: "./core/db/schema/index.ts",
    dialect: "postgresql",
    dbCredentials: {
        url: process.env.DATABASE_URL!,
    },
} satisfies Config;
