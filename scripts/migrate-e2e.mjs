import { config } from "dotenv";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

config({ path: ".env.e2e.local" });

const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(sql);

try {
    await migrate(db, { migrationsFolder: "./core/db/migrations" });
    console.log("e2e migrations applied");
} catch (err) {
    console.error("e2e migration failed:", err);
    process.exit(1);
} finally {
    await sql.end();
}
