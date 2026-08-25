import postgres from "postgres";
import {
    driftMessage,
    pendingMigrations,
    readJournalEntries,
    readLastAppliedAt,
} from "../../scripts/migration-drift.mjs";
import { BENCH_DATABASE_URL, databaseNameOf } from "./env";

/**
 * Refuses to benchmark a database that is behind `core/db/migrations`.
 *
 * `npm run bench:seed` migrates; `npm run bench` never did, and `logger_bench`
 * is seeded once and reused for weeks. On 2026-08-25 it had drifted far enough
 * that the template rollup did not exist, so the queries under measurement
 * silently fell back to scanning raw events — numbers that look like a result
 * and are a measurement of the wrong plan.
 *
 * This **checks and refuses**; it does not migrate, unlike its `itest`
 * counterpart. `DATABASE_URL` is deliberately overridable here so the same
 * benchmark can be pointed at staging over an SSH tunnel, and a setup step
 * that writes would then run DDL against staging on `npm run bench`. Reading
 * one row from `drizzle.__drizzle_migrations` is safe against any target;
 * migrating is not.
 */
export default async function setup(): Promise<void> {
    const name = databaseNameOf(BENCH_DATABASE_URL);
    const sql = postgres(BENCH_DATABASE_URL, { max: 1, onnotice: () => {} });

    try {
        const entries = readJournalEntries("./core/db/migrations");
        const pending = pendingMigrations(entries, await readLastAppliedAt(sql));

        if (pending.length > 0) {
            throw new Error(
                driftMessage(pending, {
                    label: `benchmark database "${name}"`,
                    remedy:
                        "npm run bench:seed  (rebuilds the local corpus and migrates it)\n" +
                        "For a remote target, apply the migrations there before measuring.",
                }),
            );
        }
    } finally {
        await sql.end();
    }
}
