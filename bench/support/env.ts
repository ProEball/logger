/**
 * Where the benchmark points, resolved in one place.
 *
 * `vitest.bench.config.ts` puts this into the test environment and
 * `global-setup.ts` uses it to check that database for migration drift. Those
 * two must never disagree: a drift check run against a different database than
 * the benchmark is worse than no check, because it reports "up to date" about
 * something nobody measured.
 */
export const BENCH_DATABASE_URL =
    process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/logger_bench";

/** The database name inside a connection URL, for use in messages. */
export function databaseNameOf(url: string): string {
    try {
        const name = new URL(url).pathname.replace(/^\//, "");
        return name === "" ? url : name;
    } catch {
        return url;
    }
}
