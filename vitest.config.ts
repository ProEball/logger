import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
    plugins: [react()],
    test: {
        environment: "jsdom",
        setupFiles: ["./vitest.setup.ts"],
        globals: true,
        exclude: ["node_modules/**", ".next/**", ".next-e2e/**", "e2e/**"],
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
