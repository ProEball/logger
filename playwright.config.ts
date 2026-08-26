import { defineConfig, devices } from "@playwright/test";
import { config } from "dotenv";
import { PORT, BASE_URL } from "@/e2e/support/env";

// Isolated env for e2e: points at logger_test, never the shared dev DB.
// Loaded here so both the webServer child process and the test workers
// (which inherit process.env) see the same DATABASE_URL.
config({ path: ".env.e2e.local" });

export default defineConfig({
    testDir: "./e2e",
    // Several spec files do a full-DB reset in beforeAll (auth, invite, role
    // management, theme, ...) — they assume sole ownership of the database,
    // so spec files must not run concurrently against it.
    workers: 1,
    use: {
        baseURL: BASE_URL,
    },
    webServer: {
        command: `npx next dev -p ${PORT}`,
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: {
            DATABASE_URL: process.env.DATABASE_URL!,
            AUTH_SECRET: process.env.AUTH_SECRET!,
            APP_URL: BASE_URL,
            // `next dev` hardcodes NODE_ENV=development regardless of what's
            // passed here, so next.config.ts (distDir) and proxy.ts (setup
            // cache) key off this flag instead.
            E2E_MODE: "true",
            WORKER_IN_PROCESS: process.env.WORKER_IN_PROCESS ?? "false",
            RATE_LIMIT_PER_MIN: process.env.RATE_LIMIT_PER_MIN ?? "1000",
            // The e2e run shares the dev ClickHouse *container* but never its
            // database: since Phase 2 the ingest path writes there, and
            // `resetDb()` truncates `events` between specs. `.env.e2e.local`
            // names `logger_test`, and `scripts/bootstrap-e2e.mjs` refuses to
            // run if it ever says `logger`.
            CLICKHOUSE_URL: process.env.CLICKHOUSE_URL ?? "http://localhost:8123",
            CLICKHOUSE_USER: process.env.CLICKHOUSE_USER ?? "logger",
            CLICKHOUSE_PASSWORD: process.env.CLICKHOUSE_PASSWORD ?? "logger",
            CLICKHOUSE_DATABASE: process.env.CLICKHOUSE_DATABASE ?? "logger_test",
        },
    },
    projects: [
        {
            name: "chromium",
            use: { ...devices["Desktop Chrome"] },
        },
    ],
});
