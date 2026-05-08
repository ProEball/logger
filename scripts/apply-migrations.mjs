import { readFileSync } from "fs";
import pg from "pg";

const { Client } = pg;
const DB = "postgresql://postgres:postgres@localhost:5432/logger";

const files = [
    "core/db/migrations/0000_narrow_sway.sql",
    "core/db/migrations/0001_numerous_zaladane.sql",
    "core/db/migrations/0002_boring_freak.sql",
    "core/db/migrations/0003_giant_thena.sql",
];

const c = new Client({ connectionString: DB });
await c.connect();

for (const file of files) {
    const sql = readFileSync(file, "utf8");
    const statements = sql.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);
    console.log(`\n=== ${file} (${statements.length} statements) ===`);
    for (let i = 0; i < statements.length; i++) {
        try {
            await c.query(statements[i]);
            process.stdout.write(".");
        } catch (e) {
            if (
                e.message.includes("already exists") ||
                e.message.includes("duplicate") ||
                e.message.includes("multiple primary keys")
            ) {
                process.stdout.write("s");
            } else {
                console.error(`\n  FAIL stmt ${i}: ${e.message.slice(0, 150)}`);
            }
        }
    }
}

// Register all migrations in drizzle journal
await c.query("CREATE SCHEMA IF NOT EXISTS drizzle").catch(() => {});
await c.query(`CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
    id SERIAL PRIMARY KEY,
    hash text NOT NULL,
    created_at bigint
)`).catch(() => {});

const migrationNames = [
    "0000_narrow_sway",
    "0001_numerous_zaladane",
    "0002_boring_freak",
    "0003_giant_thena",
];

for (const name of migrationNames) {
    const exists = await c.query(
        "SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = $1",
        [name],
    );
    if (exists.rows.length === 0) {
        await c.query(
            "INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)",
            [name, Date.now()],
        );
        process.stdout.write(`\nRegistered ${name}`);
    }
}

await c.end();
console.log("\n\nAll done.");
