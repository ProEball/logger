/**
 * Brings `logger_test` up from nothing: create the database, apply
 * `db/schema.sql`, then create the ClickHouse database and apply
 * `core/clickhouse/schema.sql`.
 *
 * Chained into `npm run test:e2e` rather than wired as Playwright's
 * `globalSetup`, because Playwright starts `webServer` **first** — the dev
 * server comes up, Playwright polls the base URL, `proxy.ts` queries `users`,
 * and the run dies with `database "logger_test" does not exist` before
 * globalSetup has run at all. Verified 2026-08-26 by doing it the other way.
 *
 * This closes a gap `docs/PROGRESS.md` carried since 2026-08-13: nothing ever
 * applied schema to the e2e database, so when it fell behind, five specs failed
 * with `Ingest failed: 500` — a message that points at ingest rather than at a
 * missing table. It was described then as "a line in package.json"; it is a
 * file plus that line, because the manual step nobody ran is what broke.
 *
 * Applies the same `db/schema.sql` as `core/db/bootstrap.ts` and
 * `itest/support/global-setup.ts`. There are no migrations — see bootstrap.ts.
 *
 * Since Phase 2 of docs/features/09-clickhouse.md it does the same for
 * ClickHouse. The write path goes there now, so the run needs its own
 * database — `logger_test` on the dev container, never `logger`, for the same
 * reason the Postgres side has one: `resetDb()` truncates between specs and
 * would otherwise wipe whatever a developer was looking at.
 */
import { readFileSync } from "node:fs";
import { config } from "dotenv";
import pg from "pg";
import { createClient } from "@clickhouse/client";

config({ path: ".env.e2e.local" });

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set — check .env.e2e.local");

const dbName = new URL(url).pathname.slice(1);
if (dbName === "") throw new Error(`DATABASE_URL names no database: ${url}`);

// Postgres has no CREATE DATABASE IF NOT EXISTS and the statement cannot run
// inside a transaction, so it needs its own connection to `postgres`.
const adminUrl = new URL(url);
adminUrl.pathname = "/postgres";

/**
 * Dropped and recreated, not created-if-missing.
 *
 * `db/schema.sql` describes an end state and is applied **additively**, so a
 * table removed from the schema lives on in an existing database for ever.
 * Phase 4 removed five, and one of them — `events`, with its
 * `ON DELETE RESTRICT` foreign key to `projects` — then broke `resetDb()` in
 * every spec: "update or delete on table projects violates foreign key
 * constraint events_project_id_projects_id_fk", against rows nothing writes any
 * more. Correct code, correct file, wrong database.
 *
 * That is the cost `PLAN.md` §17 accepted when the migration chain was dropped,
 * and this is where it lands: a disposable database gets torn down instead of
 * patched. Cheap here — the suite seeds everything it needs.
 */
const admin = new pg.Client({ connectionString: adminUrl.toString() });
await admin.connect();
try {
    // The name comes from our own .env.e2e.local, not from input. FORCE
    // terminates a psql session someone left open, which would otherwise make
    // the drop hang until it timed out.
    await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${dbName}"`);
    console.log(`[e2e] recreated database ${dbName}`);
} finally {
    await admin.end();
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
    // No `CREATE EXTENSION pg_partman` any more: nothing in db/schema.sql is
    // partitioned since events moved to ClickHouse. It used to be needed here
    // because db/init/01-extensions.sql only runs against the container's
    // default database and only on a fresh data directory — missing it is
    // exactly how the e2e database broke the first time.
    await client.query(readFileSync("./db/schema.sql", "utf8"));
    console.log(`[e2e] schema applied to ${dbName}`);
} finally {
    await client.end();
}

// ── ClickHouse ────────────────────────────────────────────────────────────────
// Same file the bootstrap container and the integration suite apply, so the
// e2e run cannot pass against a table shape that exists nowhere else.

const chUrl = process.env.CLICKHOUSE_URL ?? "http://localhost:8123";
const chUser = process.env.CLICKHOUSE_USER ?? "logger";
const chPassword = process.env.CLICKHOUSE_PASSWORD ?? "logger";
const chDatabase = process.env.CLICKHOUSE_DATABASE;

if (!chDatabase) throw new Error("CLICKHOUSE_DATABASE is not set — check .env.e2e.local");
if (chDatabase === "logger") {
    // A guard rather than a comment: pointing the e2e run at the dev database
    // means resetDb() truncates it between specs.
    throw new Error("refusing to bootstrap e2e against the dev ClickHouse database 'logger'");
}

const chAdmin = createClient({ url: chUrl, username: chUser, password: chPassword });
try {
    // Recreated for the same reason as the Postgres half above: an additive
    // schema cannot remove anything, and a stale column or table would sit
    // there being read by nothing until it was read by something.
    await chAdmin.command({ query: `DROP DATABASE IF EXISTS ${chDatabase}` });
    await chAdmin.command({ query: `CREATE DATABASE ${chDatabase}` });
} finally {
    await chAdmin.close();
}

const ch = createClient({
    url: chUrl,
    username: chUser,
    password: chPassword,
    database: chDatabase,
});
try {
    // ClickHouse's HTTP interface takes one statement per request. The
    // splitter is imported from core/clickhouse/ddl.ts rather than rewritten
    // here — Node strips the types on its own, and a second implementation of
    // "where does this statement end" is precisely the drift this repository
    // keeps paying for.
    const { splitDdl } = await import("../core/clickhouse/ddl.ts");
    const statements = splitDdl(readFileSync("./core/clickhouse/schema.sql", "utf8"));

    if (statements.length === 0) throw new Error("core/clickhouse/schema.sql produced no statements");

    for (const query of statements) {
        await ch.command({ query });
    }
    console.log(`[e2e] clickhouse schema applied to ${chDatabase} (${statements.length} statements)`);
} finally {
    await ch.close();
}
