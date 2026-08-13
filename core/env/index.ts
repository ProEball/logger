import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
    // t3-env probes `typeof window === "undefined"` to decide server vs client.
    // Vitest runs service and util suites under jsdom, where that probe reports
    // "client" and the proxy then refuses to hand back any server variable.
    // NODE_ENV is "test" only under the test runner — never in a real deploy.
    isServer: typeof window === "undefined" || process.env.NODE_ENV === "test",

    server: {
        DATABASE_URL: z.string().url(),
        NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
        // 32 chars is the floor for the HMAC key better-auth derives session
        // tokens from. `openssl rand -base64 32` yields 44 — comfortably above.
        AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),
        APP_URL: z.string().url().default("http://localhost"),
        LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
        // Runs pg-boss inside the Next.js process. Dev convenience only — in
        // production the worker is a separate container (see feature 08).
        WORKER_IN_PROCESS: z
            .enum(["true", "false"])
            .default("false")
            .transform((v) => v === "true"),
        // Fallback ingest quota for API keys that carry no per-key override.
        RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(1000),
        // Lets alert webhooks target private/loopback addresses. Off by default
        // because it turns the webhook sender into an SSRF primitive; turn it on
        // only for self-hosted installs posting to a service on the same network.
        ALLOW_PRIVATE_WEBHOOK_TARGETS: z
            .enum(["true", "false"])
            .default("false")
            .transform((v) => v === "true"),
    },
    client: {},
    experimental__runtimeEnv: {},
});
