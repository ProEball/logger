import path from "node:path";
import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
    // Emits `.next/standalone/server.js` plus a pruned `node_modules` containing
    // only what the traced server code actually imports. The Docker runner stage
    // copies that folder instead of installing dependencies (see `Dockerfile`).
    // `server.js` reads PORT/HOSTNAME from the environment — the container sets
    // both; `npm run start` (port 80) is unaffected and stays the local path.
    output: "standalone",
    // The help centre reads its articles from `docs/reference/*.md` at runtime
    // via `path.join(process.cwd(), …)` (see `help-content.service.ts`). Next's
    // file tracer only follows static imports, so it cannot see that read and
    // the standalone output would ship without the articles — every help page
    // would 500 in production while working perfectly in dev. Declaring the
    // dependency here fixes it for any deployment target, not just our image.
    outputFileTracingIncludes: {
        "/*": ["docs/reference/**/*.md"],
    },
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
    // Static security headers. The per-request `Content-Security-Policy` is set
    // in `proxy.ts` instead — it carries a fresh nonce on every response.
    async headers() {
        return [
            {
                source: "/(.*)",
                headers: [
                    { key: "X-Content-Type-Options", value: "nosniff" },
                    // Belt-and-braces alongside CSP `frame-ancestors 'none'`,
                    // for the few agents that honour only this one.
                    { key: "X-Frame-Options", value: "DENY" },
                    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
                    { key: "X-DNS-Prefetch-Control", value: "off" },
                    {
                        key: "Permissions-Policy",
                        value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
                    },
                    // Ignored by browsers over plain HTTP, but only ever correct
                    // once the app is actually served over TLS — so gate it on
                    // production rather than sending it from a dev server.
                    ...(isProd
                        ? [
                              {
                                  key: "Strict-Transport-Security",
                                  value: "max-age=63072000; includeSubDomains; preload",
                              },
                          ]
                        : []),
                ],
            },
        ];
    },
};

export default nextConfig;
