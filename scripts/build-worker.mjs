/**
 * Bundles the Node entrypoints that live outside the Next.js build:
 * the standalone worker and the one-shot schema bootstrap.
 *
 * `next build` only compiles what is reachable from `app/`, so neither
 * `core/worker/main.ts` nor `core/db/bootstrap.ts` appears in `.next/standalone`.
 * Each is bundled here into a single self-contained CJS file with its
 * dependencies inlined — the runtime image therefore needs no `node_modules`
 * of its own for these processes, and a worker-only dependency added later
 * cannot silently go missing the way it would if we relied on Next's file
 * trace to have happened to include it.
 *
 * Usage: node scripts/build-worker.mjs [--outdir dist]
 */
import { fileURLToPath } from "node:url";
import path from "node:path";
import { build } from "esbuild";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const outDirArgIndex = process.argv.indexOf("--outdir");
const outDir = path.resolve(
    rootDir,
    outDirArgIndex === -1 ? "dist" : process.argv[outDirArgIndex + 1],
);

const ENTRYPOINTS = {
    worker: "core/worker/main.ts",
    bootstrap: "core/db/bootstrap.ts",
};

await build({
    entryPoints: Object.entries(ENTRYPOINTS).map(([out, entry]) => ({
        in: path.join(rootDir, entry),
        out,
    })),
    outdir: outDir,
    bundle: true,
    platform: "node",
    // Matches the `node:22-alpine` base image in the Dockerfile. Bump both
    // together — a target ahead of the runtime silently emits syntax the
    // container cannot parse.
    target: "node22",
    // CJS rather than ESM: the dependency graph mixes both (pg-boss is pure
    // ESM, pino is pure CJS), and esbuild's CJS output handles that mix
    // without the `__require` shims its ESM output needs for CJS deps.
    format: "cjs",
    // Mirrors the `@/*` path alias in tsconfig.json. Declared explicitly rather
    // than read from tsconfig so a change there cannot break the build silently.
    alias: { "@": rootDir },
    resolveExtensions: [".ts", ".mts", ".js", ".mjs", ".json"],
    sourcemap: true,
    // Names survive into stack traces; the size cost is irrelevant for a
    // server-side bundle nobody downloads.
    minify: false,
    logLevel: "info",
});

console.log(`Bundled ${Object.keys(ENTRYPOINTS).join(", ")} → ${path.relative(rootDir, outDir)}/`);
