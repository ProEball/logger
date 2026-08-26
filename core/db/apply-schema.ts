import { readFileSync } from "node:fs";
import path from "node:path";
import type postgres from "postgres";
import type { ClickHouseClient } from "@clickhouse/client";

/**
 * Applying each store's schema file. The work `core/db/bootstrap.ts` does,
 * separated from it so it can be tested.
 *
 * The split is the point: `bootstrap.ts` calls `main()` at module scope and
 * `process.exit(1)` on failure, because it is an entrypoint and must run when
 * the container runs it. Importing it in a test would execute it. Guarding that
 * call with a `require.main === module` check would make it importable, but it
 * would also mean a bundler quirk could turn the bootstrap into a silent no-op
 * — an app starting against a database with no tables, reporting nothing. The
 * two functions below move instead; the entrypoint keeps its unconditional call
 * and has nothing left in it to test.
 *
 * Both take their client — and the file reader — as arguments rather than
 * importing the singletons, so a test supplies stubs without mocking module
 * resolution. `splitDdl` is passed the same way. Every boundary this module
 * touches is a parameter, which is why it needs no `vi.mock` at all.
 */

type PgSql = ReturnType<typeof postgres>;

/** The filesystem, as a parameter. Overridden only by tests. */
export type ReadFile = (file: string) => string;

const defaultReadFile: ReadFile = (file) => readFileSync(file, "utf8");

/** Repo-relative, and kept that way inside the image — see the Dockerfile. */
export const POSTGRES_SCHEMA_PATH = path.join("db", "schema.sql");
export const CLICKHOUSE_SCHEMA_PATH = path.join("core", "clickhouse", "schema.sql");

export function postgresSchemaFile(schemaDir: string): string {
    return path.join(schemaDir, POSTGRES_SCHEMA_PATH);
}

export function clickhouseSchemaFile(schemaDir: string): string {
    return path.join(schemaDir, CLICKHOUSE_SCHEMA_PATH);
}

/**
 * Applies `db/schema.sql` whole.
 *
 * `.simple()` sends it as one simple-protocol query, which Postgres runs inside
 * a single implicit transaction: the schema arrives whole or not at all. It is
 * also why this side needs no statement splitter.
 */
export async function applyPostgresSchema(
    sql: PgSql,
    schemaDir: string,
    readFile: ReadFile = defaultReadFile,
): Promise<string> {
    const file = postgresSchemaFile(schemaDir);
    const ddl = readFile(file);

    if (ddl.trim() === "") throw new Error(`${file} is empty`);

    await sql.unsafe(ddl).simple();
    return file;
}

/**
 * Applies `core/clickhouse/schema.sql`, one statement per request.
 *
 * ClickHouse has no transactional DDL and its HTTP interface takes a single
 * statement, so a failure halfway leaves the earlier statements applied. Every
 * statement is written to be idempotent — `IF NOT EXISTS`, or an `ALTER … MODIFY
 * SETTING` that sets a value rather than changing one — so the fix is to correct
 * the file and re-run rather than to unpick anything.
 *
 * The `ALTER` form matters: `CREATE TABLE IF NOT EXISTS` does nothing at all to
 * a table that already exists, so a setting added to the `CREATE` after the
 * fact would silently never reach any database built before it.
 */
export async function applyClickhouseSchema(
    client: Pick<ClickHouseClient, "command">,
    schemaDir: string,
    splitDdl: (sql: string) => string[],
    readFile: ReadFile = defaultReadFile,
): Promise<{ file: string; statements: number }> {
    const file = clickhouseSchemaFile(schemaDir);
    const statements = splitDdl(readFile(file));

    // An empty file means the splitter or the file is broken, and applying
    // nothing would look exactly like success — the container exits 0 and
    // compose lets the app start against a database with no tables.
    if (statements.length === 0) throw new Error(`${file} contains no statements`);

    for (const statement of statements) {
        await client.command({ query: statement });
    }

    return { file, statements: statements.length };
}
