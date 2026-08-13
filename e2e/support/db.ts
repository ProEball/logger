import { Client } from "pg";

// playwright.config.ts loads .env.e2e.local before workers spawn, so this
// always points at the isolated logger_test database — never the dev DB.
export const DB_URL = process.env.DATABASE_URL as string;

if (!DB_URL) {
    throw new Error("DATABASE_URL is not set — e2e tests must run through playwright.config.ts (npm run test:e2e)");
}

export async function withDb<T>(fn: (client: Client) => Promise<T>): Promise<T> {
    const client = new Client({ connectionString: DB_URL });
    await client.connect();
    try {
        return await fn(client);
    } finally {
        await client.end();
    }
}
