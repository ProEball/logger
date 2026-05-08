import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/core/env";

// Singleton pattern: prevents connection pool explosion during Next.js hot reload.
// Without this, each module re-evaluation creates a new pool (leaking connections).
declare global {
    // eslint-disable-next-line no-var
    var _pgClient: ReturnType<typeof postgres> | undefined;
}

const pgClient =
    global._pgClient ??
    postgres(env.DATABASE_URL, {
        max: 10, // pool size per process — keeps total connections predictable
        idle_timeout: 20,
        connect_timeout: 10,
    });

if (process.env.NODE_ENV !== "production") {
    global._pgClient = pgClient;
}

export const db = drizzle(pgClient);
export { pgClient };
