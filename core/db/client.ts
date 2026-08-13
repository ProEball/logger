import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/core/env";
import { wrapWithSlowQueryLogger } from "@/core/db/middleware/slow-query-logger";

// Singleton pattern: prevents connection pool explosion during Next.js hot reload.
// Without this, each module re-evaluation creates a new pool (leaking connections).
declare global {
    var _pgClient: ReturnType<typeof postgres> | undefined;
}

const rawClient =
    global._pgClient ??
    postgres(env.DATABASE_URL, {
        max: 10, // pool size per process — keeps total connections predictable
        idle_timeout: 20,
        connect_timeout: 10,
    });

if (process.env.NODE_ENV !== "production") {
    global._pgClient = rawClient;
}

export const pgClient = wrapWithSlowQueryLogger(rawClient);
export const db = drizzle(pgClient);
