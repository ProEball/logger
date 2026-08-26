import { readFileSync } from "node:fs";
import postgres from "postgres";
import { createClient, type ClickHouseClient } from "@clickhouse/client";
import {
    ITEST_ADMIN_URL,
    ITEST_DATABASE_URL,
    ITEST_DB_NAME,
    ITEST_CH_DATABASE,
    ITEST_CH_URL,
    ITEST_CH_USER,
    ITEST_CH_PASSWORD,
} from "./env";
import { splitDdl } from "@/core/clickhouse/ddl";
import { applyClickhouseSchema } from "@/core/db/apply-schema";
import { seedCorpus } from "./fixture";

/**
 * Brings `logger_itest` up from nothing: create, extend, apply schema, seed.
 *
 * Everything here is idempotent, and the database is created in code rather
 * than by hand. That is a direct response to how the e2e database went: it was
 * created manually, `pg_partman` was missed because `db/init/01-extensions.sql`
 * only runs against the container's default database on first init, and
 * `drizzle-kit migrate` then failed silently behind its spinner. The cost of
 * that was an afternoon; the cost of these forty lines is forty lines.
 *
 * It applies `db/schema.sql` — the same file the `bootstrap` container applies,
 * not a second definition of the same tables. There are no migrations any more;
 * see `core/db/bootstrap.ts` for why, and for what that costs.
 *
 * Since Phase 2 of docs/features/09-clickhouse.md it does the same for
 * ClickHouse: `test:it` now needs both databases up, which §11 of that plan
 * named as the cost of losing Drizzle on the events path.
 */

/**
 * Drops and recreates `logger_itest`, rather than creating it when missing.
 *
 * **This changed in Phase 4, and the reason is the cost of having no
 * migrations.** `db/schema.sql` describes an end state and is applied
 * additively, so a table *removed* from the schema stays in an existing
 * database forever. Phase 4 removed five, and one of them —  `events`, with its
 * `ON DELETE RESTRICT` foreign key to `projects` — would then block the
 * fixture's own `DELETE FROM projects` with rows nothing writes any more. The
 * failure is confusing in exactly the way a stale schema always is: correct
 * code, correct file, wrong database.
 *
 * Recreating is affordable here and only here: the corpus is forty rows and
 * this database exists for nothing else. `PLAN.md` §17 accepted "tear down and
 * rebuild" as the answer to schema drift; this is that answer applied where it
 * is cheap.
 */
async function recreateDatabase(): Promise<void> {
    const admin = postgres(ITEST_ADMIN_URL, { max: 1, onnotice: () => {} });
    try {
        // Names are module constants rather than input, so interpolation is
        // safe — and neither statement has a parameterised form.
        await admin.unsafe(`DROP DATABASE IF EXISTS ${ITEST_DB_NAME} WITH (FORCE)`);
        await admin.unsafe(`CREATE DATABASE ${ITEST_DB_NAME}`);
        console.log(`[itest] recreated database ${ITEST_DB_NAME}`);
    } finally {
        await admin.end();
    }
}

/**
 * The same, for ClickHouse — create the database, then apply
 * `core/clickhouse/schema.sql` through the very function the bootstrap
 * container uses, so the suite cannot run against a table shape that only
 * exists here.
 *
 * The client is built locally rather than imported from
 * `core/clickhouse/client.ts`: that module reads `@/core/env` at import time,
 * and `globalSetup` runs outside the worker where `test.env` is applied.
 */
async function ensureClickhouseSchema(): Promise<ClickHouseClient> {
    const admin = createClient({
        url: ITEST_CH_URL,
        username: ITEST_CH_USER,
        password: ITEST_CH_PASSWORD,
    });
    try {
        // Dropped as well, and for a second reason on top of schema drift:
        // `clickhouse-ingest.service.itest.ts` writes under a fresh project id
        // on every run, so its rows would otherwise accumulate in this table
        // for ever.
        await admin.command({ query: `DROP DATABASE IF EXISTS ${ITEST_CH_DATABASE}` });
        await admin.command({ query: `CREATE DATABASE ${ITEST_CH_DATABASE}` });
    } finally {
        await admin.close();
    }

    const client = createClient({
        url: ITEST_CH_URL,
        username: ITEST_CH_USER,
        password: ITEST_CH_PASSWORD,
        database: ITEST_CH_DATABASE,
    });
    await applyClickhouseSchema(client, ".", splitDdl);
    // Handed back rather than closed: the caller seeds the corpus through it.
    return client;
}

export default async function setup(): Promise<void> {
    await recreateDatabase();
    const ch = await ensureClickhouseSchema();

    // The schema is idempotent and emits "already exists" notices on every
    // re-run; they are noise, not information.
    const sql = postgres(ITEST_DATABASE_URL, { max: 1, onnotice: () => {} });
    try {
        // Sent as one simple-protocol query, which Postgres runs inside a
        // single implicit transaction — same as applyPostgres() in bootstrap.ts.
        await sql.unsafe(readFileSync("./db/schema.sql", "utf8")).simple();

        await seedCorpus(sql, ch);
    } catch (err) {
        console.error("[itest] setup failed:", err);
        throw err;
    } finally {
        await sql.end();
        await ch.close();
    }
}
