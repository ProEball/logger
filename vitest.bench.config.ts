import { defineConfig } from "vitest/config";
import { resolve } from "path";
import { BENCH_DATABASE_URL } from "./bench/support/env";

/**
 * Benchmarks — `npm run bench`.
 *
 * Deliberately **not** pinned to a database. `DATABASE_URL` comes from the
 * environment so the same file measures a local corpus, the staging server
 * over an SSH tunnel, or anything else, without editing the benchmark. That is
 * the whole point: `PLAN.md` §16.1 Stage C exists because every number we have
 * so far was produced by typing `EXPLAIN` by hand, which cannot prove that a
 * change helped and cannot compare two machines.
 *
 * Reading the results:
 * - The measurements are **wall-clock, client side**, so they include one
 *   network round trip per query. Over an SSH tunnel that is tens of
 *   milliseconds. Every run measures the round-trip floor as its first
 *   benchmark ("round-trip floor") — read every other number net of it.
 * - `--outputJson` writes a machine-readable report; keep the baseline file so
 *   later runs have something to be compared against.
 */
export default defineConfig({
    test: {
        environment: "node",
        globals: true,
        include: ["**/*.bench.ts"],
        exclude: ["node_modules/**", ".next/**", ".next-e2e/**", "e2e/**"],
        // A single aggregation was measured at 654 ms on the staging data;
        // vitest's default of running for 500 ms would give one sample.
        benchmark: {
            include: ["**/*.bench.ts"],
        },
        // Refuses to run against a database behind core/db/migrations. `bench`
        // checks rather than migrates, because the target may be staging over
        // an SSH tunnel; without the check a stale corpus measures the wrong
        // query plan and reports it as a number. See bench/support/global-setup.ts.
        globalSetup: ["./bench/support/global-setup.ts"],
        env: {
            // Falls back to the local bench corpus. Override to point the same
            // benchmark somewhere else:
            //   ssh -N -L 5433:localhost:5432 user@host
            //   DATABASE_URL=postgresql://logger:…@localhost:5433/logger npm run bench
            DATABASE_URL: BENCH_DATABASE_URL,
            AUTH_SECRET: "bench-secret-at-least-32-characters-long",
            APP_URL: "http://localhost",
            LOG_LEVEL: "fatal",
        },
    },
    resolve: {
        alias: {
            "@": resolve(__dirname, "."),
        },
    },
});
