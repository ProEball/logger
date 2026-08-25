import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
    plugins: [react()],
    test: {
        environment: "jsdom",
        setupFiles: ["./vitest.setup.ts"],
        globals: true,
        // `**/*.itest.ts` needs a real Postgres and runs via
        // `npm run test:it` (vitest.integration.config.ts). Excluded here so
        // that `npm run test` keeps working with no database at all.
        // `.claude/worktrees/**` holds git worktrees that agent tasks run in.
        // Each is a full checkout, so without this a single background task
        // doubles the suite and reports **its** copy's failures as this one's:
        // observed 2026-08-25 as "13 failed files" that were one worktree at an
        // older commit. Excluded in all three vitest configs, not just here.
        exclude: [
            "node_modules/**",
            ".next/**",
            ".next-e2e/**",
            ".claude/worktrees/**",
            "e2e/**",
            "**/*.itest.ts",
        ],
        // `@/core/env` validates the whole server schema the moment it is
        // imported, so any module under test that reaches it needs these set.
        // Values are throwaway — nothing here connects to a real database.
        env: {
            DATABASE_URL: "postgresql://test:test@localhost:5432/test",
            AUTH_SECRET: "test-secret-at-least-32-characters-long",
            APP_URL: "http://localhost",
        },
    },
    resolve: {
        alias: {
            "@": resolve(__dirname, "."),
        },
    },
});
