import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // E2E build dir (see `distDir` in next.config.ts) — build output, not source.
    ".next-e2e/**",
    // esbuild bundles for the worker and migrate entrypoints (npm run
    // build:worker). Generated, and every inlined dependency in them would
    // otherwise be linted as if it were ours.
    "dist/**",
    // Design system handoff bundle from claude.ai/design — reference, not our code.
    "docs/designs/**",
  ]),
  {
    rules: {
      // A leading underscore is the project's marker for "declared to satisfy a
      // signature, deliberately unused" — test spies that only need their call
      // arguments recorded, and props kept for API symmetry.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
]);

export default eslintConfig;
