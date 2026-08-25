/**
 * Is a database behind `core/db/migrations`?
 *
 * The drizzle migrator decides what to apply by comparing each journal entry's
 * `when` against the single newest `created_at` in
 * `drizzle.__drizzle_migrations` (`PgDialect.migrate`). It does not compare
 * hashes and it does not fill gaps below that watermark. This module
 * reproduces that comparison exactly, so a **read-only** check reports the
 * same set the migrator would apply — no more, no less. Reimplementing it
 * loosely (say, by counting rows) would report drift that migrating cannot
 * fix, which is worse than not checking.
 *
 * It exists because a stale database does not announce itself. On 2026-08-25
 * `logger_test` sat five migrations behind and the only symptom was five e2e
 * specs failing with `Ingest failed: 500 {"error":"Internal server error."}`
 * — an error that points squarely at the ingest path, which was fine. The
 * same drift in `logger_bench` made the template rollup unreachable and would
 * have produced benchmark numbers that looked plausible and measured the
 * wrong plan.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * @typedef {object} JournalEntry
 * @property {number} idx
 * @property {number} when   Millisecond stamp drizzle stores as `created_at`.
 * @property {string} tag    Migration file name without `.sql`, e.g. `0013_ambitious_sabra`.
 */

/**
 * Reads `meta/_journal.json` and returns its entries oldest-first.
 *
 * @param {string} migrationsFolder
 * @returns {JournalEntry[]}
 */
export function readJournalEntries(migrationsFolder) {
    const raw = readFileSync(join(migrationsFolder, "meta", "_journal.json"), "utf8");
    const journal = JSON.parse(raw);
    return [...journal.entries].sort((a, b) => a.when - b.when);
}

/**
 * The migrations a database is missing, oldest-first.
 *
 * `lastAppliedAt` is the newest `created_at` in the migrations table, or
 * `null` when nothing has ever been applied (or the table does not exist yet).
 *
 * @param {JournalEntry[]} entries
 * @param {number | null} lastAppliedAt
 * @returns {JournalEntry[]}
 */
export function pendingMigrations(entries, lastAppliedAt) {
    const sorted = [...entries].sort((a, b) => a.when - b.when);
    if (lastAppliedAt === null) return sorted;
    return sorted.filter((entry) => entry.when > lastAppliedAt);
}

/**
 * True when the error means "the migrations table is not there yet", which is
 * an empty database rather than a failure.
 *
 * `42P01` is undefined_table, `3F000` is invalid_schema_name — the latter is
 * what a database that has never been migrated actually raises, because the
 * `drizzle` schema itself is missing. Every other code is a real problem
 * (unreachable host, bad credentials, no such database) and must not be
 * mistaken for "nothing applied yet".
 *
 * @param {unknown} err
 * @returns {boolean}
 */
export function isMissingMigrationsTable(err) {
    const code = /** @type {{ code?: unknown }} */ (err)?.code;
    return code === "42P01" || code === "3F000";
}

/**
 * The newest `created_at` recorded in `drizzle.__drizzle_migrations`, or
 * `null` if the table is absent or empty. Read-only: safe to run against a
 * database you must not modify, such as staging over an SSH tunnel.
 *
 * @param {import("postgres").Sql} sql
 * @returns {Promise<number | null>}
 */
export async function readLastAppliedAt(sql) {
    try {
        const rows = await sql`
            SELECT created_at FROM drizzle.__drizzle_migrations
            ORDER BY created_at DESC
            LIMIT 1
        `;
        const value = rows[0]?.created_at;
        return value === undefined || value === null ? null : Number(value);
    } catch (err) {
        if (isMissingMigrationsTable(err)) return null;
        throw err;
    }
}

/**
 * Human-readable drift report. Names the tags, because "5 migrations behind"
 * is not enough to tell whether the one you just wrote is among them.
 *
 * @param {JournalEntry[]} pending
 * @param {{ label: string, remedy: string }} target
 * @returns {string}
 */
export function driftMessage(pending, { label, remedy }) {
    const tags = pending.map((entry) => entry.tag).join(", ");
    const plural = pending.length === 1 ? "migration" : "migrations";
    return (
        `${label} is ${pending.length} ${plural} behind core/db/migrations: ${tags}\n` +
        `Run: ${remedy}`
    );
}
