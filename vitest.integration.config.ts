import { defineConfig } from "vitest/config";
import { resolve } from "path";
import { ITEST_DATABASE_URL } from "./itest/support/env";

/**
 * Integration tests — the ones that need a real Postgres.
 *
 * Deliberately a separate config rather than a second project inside
 * `vitest.config.ts`: `npm run test` must keep working on a machine with no
 * Docker running, and the surest way to guarantee that is for the default run
 * to have no way of selecting these files at all. `vitest.config.ts` also
 * excludes `**\/*.itest.ts` so a glob change there cannot pull them in by
 * accident.
 *
 * Why these exist: `shared/services/event-aggregations.service.ts` is raw
 * SQL through `db.execute()`. The repository's mocking pattern stubs the
 * Drizzle query builder and cannot reach them, and asserting on generated SQL
 * text would test the string rather than the answer — it breaks on
 * reformatting and passes on a semantically wrong query. See
 * `docs/reference/misc.md#testing`.
 */
export default defineConfig({
    test: {
        // Node, not jsdom: nothing here renders, and postgres.js wants real sockets.
        environment: "node",
        globals: true,
        include: ["**/*.itest.ts"],
        exclude: ["node_modules/**", ".next/**", ".next-e2e/**", ".claude/worktrees/**", "e2e/**"],
        globalSetup: ["./itest/support/global-setup.ts"],
        // The corpus is seeded once and every test is read-only, so files can
        // share it. If a test ever needs to write, it must create its own
        // project rather than mutating the fixture.
        fileParallelism: true,
        // Creating the database, migrating it and seeding takes longer than
        // vitest's default hook timeout.
        hookTimeout: 120_000,
        testTimeout: 30_000,
        env: {
            // `@/core/env` validates the whole server schema on import, and
            // `@/core/db/client` reads DATABASE_URL from it at module load —
            // so this has to be set before any import of the service.
            DATABASE_URL: ITEST_DATABASE_URL,
            AUTH_SECRET: "itest-secret-at-least-32-characters-long",
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
