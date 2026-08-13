import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    // Without this, Next only trusts whichever host the dev server first saw
    // a request from; any other host (e.g. switching from `localhost` to
    // `127.0.0.1`, or vice versa) gets its HMR/dev-resource requests blocked
    // as cross-origin, which breaks client hydration entirely — forms fall
    // back to native (unhandled) submission and client-side routing stalls.
    allowedDevOrigins: ["localhost", "127.0.0.1"],
    // e2e runs its own server instance (see playwright.config.ts) alongside
    // the normal dev server — a separate build dir avoids the "another next
    // dev server is already running" lock conflict on the shared .next dir.
    // `next dev` hardcodes NODE_ENV=development regardless of what's passed
    // in, so a dedicated flag is used instead of NODE_ENV to detect e2e mode.
    distDir: process.env.E2E_MODE === "true" ? ".next-e2e" : ".next",
    sassOptions: {
        // Lets `.scss` files use bare imports rooted at the project, e.g.
        //   @use 'app/styles/mixins' as *;
        // Mirrors the `@/*` TS path alias in tsconfig.json.
        loadPaths: [path.resolve(process.cwd())],
    },
};

export default nextConfig;
