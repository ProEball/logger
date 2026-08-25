/**
 * Brings the isolated e2e database (`logger_test`) up to the migrations
 * folder. Run automatically by `npm run test:e2e`; still available on its own
 * as `npm run db:migrate:e2e`.
 *
 * Uses the programmatic `drizzle-orm/postgres-js` migrator rather than the
 * `drizzle-kit migrate` CLI, which swallows errors behind its progress spinner
 * in this environment — it fails outright, with no visible output, against a
 * database missing `pg_partman` (migration 0003 calls `create_parent()`).
 */

import { config } from "dotenv";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import {
    pendingMigrations,
    readJournalEntries,
    readLastAppliedAt,
} from "./migration-drift.mjs";

const MIGRATIONS_FOLDER = "./core/db/migrations";

config({ path: ".env.e2e.local" });

// Load-bearing now that this runs on every `npm run test:e2e`. Without it,
// postgres.js falls back to its own defaults (localhost, the OS user, a
// same-named database) and would migrate whatever that happens to reach —
// silently, and not the database anybody meant.
if (!process.env.DATABASE_URL) {
    console.error(
        "DATABASE_URL is not set. `.env.e2e.local` should exist and point at the\n" +
            "isolated e2e database (logger_test) — see docs/reference/misc.md#testing.",
    );
    process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });

try {
    const entries = readJournalEntries(MIGRATIONS_FOLDER);
    const pending = pendingMigrations(entries, await readLastAppliedAt(sql));

    if (pending.length === 0) {
        console.log(`e2e database already at ${entries.at(-1)?.tag ?? "an empty journal"}`);
    } else {
        await migrate(drizzle(sql), { migrationsFolder: MIGRATIONS_FOLDER });
        console.log(
            `e2e migrations applied: ${pending.map((entry) => entry.tag).join(", ")}`,
        );
    }
} catch (err) {
    console.error("e2e migration failed:", err);
    process.exit(1);
} finally {
    await sql.end();
}
