import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/core/env";

const pgClient = postgres(env.DATABASE_URL);

export const db = drizzle(pgClient);
export { pgClient };
