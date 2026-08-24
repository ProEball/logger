import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The Postgres settings live in three files that have to agree, and nothing
 * but a reader's attention held them together until 2026-08-24.
 *
 * `docker-compose.dev.yml` said it "mirrors the production command" while
 * exposing two of the five knobs production had. Nobody noticed, because a
 * missing knob does not fail — it silently falls back to the upstream default,
 * so the dev database quietly runs a different configuration than the one being
 * tuned. That is the same failure shape as `NEXT_PUBLIC_APP_URL`: a variable
 * that exists in one place, is read in another, and drifts in between.
 *
 * These are file-shape assertions, not behaviour. They cannot tell whether
 * `work_mem=32MB` is a good number — only whether the three files still
 * describe the same set of settings. That is exactly the part a person cannot
 * check at a glance and a machine can.
 */

/**
 * Resolved from the working directory, not from `import.meta.url`. Under
 * Vitest on Windows the transformed module's `import.meta.url` is not the
 * file's own path, so `new URL("../x", import.meta.url)` resolved to `D:\x`.
 * Vitest sets the working directory to the config root, which is the repo root.
 */
const read = (name) => readFileSync(resolve(process.cwd(), name), "utf8");

const PROD = read("docker-compose.yml");
const DEV = read("docker-compose.dev.yml");
const ENV_EXAMPLE = read(".env.production.example");

/**
 * `- shared_buffers=${PG_SHARED_BUFFERS:-128MB}` -> one entry.
 *
 * `[^}]*` rather than `.*` matters for `${PG_LOG_TEMP_FILES:--1}`, whose
 * default legitimately starts with the same `-` the `:-` operator ends with.
 */
function tuningArgs(compose) {
    const found = new Map();
    const re = /-\s*([a-z_]+)=\$\{(PG_[A-Z0-9_]+):-([^}]*)\}/g;

    for (const [, setting, variable, fallback] of compose.matchAll(re)) {
        found.set(variable, { setting, fallback });
    }
    return found;
}

/** Uncommented `NAME=value` assignments. */
function assignments(envFile) {
    const found = new Map();
    const re = /^(PG_[A-Z0-9_]+)=(.*)$/gm;

    for (const [, name, value] of envFile.matchAll(re)) {
        found.set(name, value.trim());
    }
    return found;
}

const prodArgs = tuningArgs(PROD);
const devArgs = tuningArgs(DEV);
const envVars = assignments(ENV_EXAMPLE);

describe("postgres tuning configuration", () => {
    it("exposes every setting through a variable", () => {
        // A guard on the guard: if the regex ever stops matching, every
        // assertion below passes vacuously over two empty maps.
        expect(prodArgs.size).toBeGreaterThanOrEqual(10);
    });

    it("keeps the dev compose a real mirror of production", () => {
        expect([...devArgs.keys()].sort()).toEqual([...prodArgs.keys()].sort());
    });

    it("maps each variable to the same Postgres setting in both files", () => {
        for (const [variable, { setting }] of prodArgs) {
            expect(devArgs.get(variable)?.setting, variable).toBe(setting);
        }
    });

    it("falls back to the same value in both files", () => {
        for (const [variable, { fallback }] of prodArgs) {
            expect(devArgs.get(variable)?.fallback, variable).toBe(fallback);
        }
    });

    /**
     * Both directions, and the second is the one that bites. A variable set in
     * the example file that no compose file reads is a setting the operator
     * believes is applied and which does nothing at all — invisible, because
     * Postgres reports the default it was never asked to change.
     */
    it("documents every variable the compose files read", () => {
        for (const variable of prodArgs.keys()) {
            expect(envVars.has(variable), `${variable} missing from .env.production.example`).toBe(
                true,
            );
        }
    });

    it("reads every variable the example file sets", () => {
        for (const variable of envVars.keys()) {
            expect(prodArgs.has(variable), `${variable} is set but no compose file reads it`).toBe(
                true,
            );
        }
    });

    /**
     * `docker-compose.yml` states in a comment that its fallbacks are stock
     * Postgres values and stay that way, because the file cannot know the host
     * it will run on. This holds the file to that claim.
     *
     * Values are for the `postgres:16` image the db/Dockerfile builds from. If
     * that base image is upgraded and a default changes with it, this test
     * fails — which is the intent: the comment would have become false.
     */
    it("keeps the compose fallbacks at Postgres 16 stock values", () => {
        const stock = {
            shared_buffers: "128MB",
            work_mem: "4MB",
            effective_cache_size: "4GB",
            maintenance_work_mem: "64MB",
            random_page_cost: "4.0",
            effective_io_concurrency: "1",
            max_parallel_workers_per_gather: "2",
            jit: "on",
            track_io_timing: "off",
            log_temp_files: "-1",
        };

        const actual = Object.fromEntries(
            [...prodArgs.values()].map(({ setting, fallback }) => [setting, fallback]),
        );

        expect(actual).toEqual(stock);
    });

    /**
     * The sized profile is the point of the file. If someone comments the
     * block out again, the install silently reverts to 128 MB of shared buffers
     * and the 17-second query comes back with no diff to explain it.
     */
    it("ships a profile that is actually sized, not the stock values", () => {
        expect(envVars.get("PG_SHARED_BUFFERS")).not.toBe("128MB");
        expect(envVars.get("PG_WORK_MEM")).not.toBe("4MB");
        expect(envVars.get("PG_JIT")).toBe("off");
        expect(envVars.get("PG_TRACK_IO_TIMING")).toBe("on");
    });
});
