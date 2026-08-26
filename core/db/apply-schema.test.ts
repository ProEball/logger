import { describe, it, expect, vi } from "vitest";

/**
 * No `vi.mock` anywhere in this file. Every boundary `apply-schema.ts` touches —
 * the Postgres client, the ClickHouse client, the DDL splitter and the file
 * reader — is a parameter, so a test passes stubs directly. Mocking module
 * resolution for `node:fs` was tried first and silently did not take: the real
 * schema file came back and the assertions failed against 119 lines of DDL.
 */
const reads = (content: string) => vi.fn().mockReturnValue(content);

import {
    applyPostgresSchema,
    applyClickhouseSchema,
    postgresSchemaFile,
    clickhouseSchemaFile,
} from "./apply-schema";

/** Minimal stand-in for postgres.js: `sql.unsafe(ddl).simple()`. */
function fakeSql(simpleResult: Promise<unknown> = Promise.resolve(undefined)) {
    // Attached so an unawaited rejection cannot surface as an unhandled one
    // before the assertion gets to it.
    simpleResult.catch(() => {});
    const simple = vi.fn(() => simpleResult);
    const unsafe = vi.fn(() => ({ simple }));
    return { sql: { unsafe } as never, unsafe, simple };
}

describe("schema file locations", () => {
    /**
     * The image copies both files under their repo-relative paths rather than
     * flattening them, precisely so one pair of strings works in a checkout and
     * in the container. If these ever diverge, the bootstrap container fails
     * with ENOENT at deploy time and nowhere earlier.
     */
    it("joins SCHEMA_DIR to the repo-relative paths", () => {
        expect(postgresSchemaFile("/app/schema").split(/[\\/]/)).toEqual([
            "",
            "app",
            "schema",
            "db",
            "schema.sql",
        ]);
        expect(clickhouseSchemaFile("/app/schema").split(/[\\/]/)).toEqual([
            "",
            "app",
            "schema",
            "core",
            "clickhouse",
            "schema.sql",
        ]);
    });

    it("defaults to the checkout layout when SCHEMA_DIR is '.'", () => {
        expect(postgresSchemaFile(".").split(/[\\/]/)).toEqual(["db", "schema.sql"]);
        expect(clickhouseSchemaFile(".").split(/[\\/]/)).toEqual([
            "core",
            "clickhouse",
            "schema.sql",
        ]);
    });
});

describe("applyPostgresSchema", () => {
    it("sends the whole file as one simple-protocol query", async () => {
        const { sql, unsafe, simple } = fakeSql();

        const file = await applyPostgresSchema(sql, ".", reads('CREATE TABLE IF NOT EXISTS "a" ();'));

        expect(unsafe).toHaveBeenCalledExactlyOnceWith('CREATE TABLE IF NOT EXISTS "a" ();');
        expect(simple).toHaveBeenCalledOnce();
        expect(file).toContain("schema.sql");
    });

    /**
     * Applying nothing looks exactly like success: the container exits 0 and
     * compose lets the app start against a database with no tables. An empty or
     * unwritten schema file has to be an error, not a quiet no-op.
     */
    it("refuses an empty schema file", async () => {
        const { sql, unsafe } = fakeSql();

        await expect(applyPostgresSchema(sql, ".", reads("   \n\n  "))).rejects.toThrow(/is empty/);
        expect(unsafe).not.toHaveBeenCalled();
    });

    it("propagates a failure rather than reporting success", async () => {
        const { sql } = fakeSql(Promise.reject(new Error("syntax error at or near")));

        await expect(applyPostgresSchema(sql, ".", reads("CREATE TABLE a ();"))).rejects.toThrow(
            "syntax error at or near",
        );
    });
});

describe("applyClickhouseSchema", () => {
    it("issues one request per statement, in file order", async () => {
        const command = vi.fn().mockResolvedValue(undefined);
        const split = (s: string) => s.split(";").map((x) => x.trim()).filter(Boolean);
        const read = reads("CREATE TABLE a (x UInt8);\nCREATE TABLE b (y UInt8);");

        const result = await applyClickhouseSchema({ command }, ".", split, read);

        expect(command.mock.calls.map(([c]) => c.query)).toEqual([
            "CREATE TABLE a (x UInt8)",
            "CREATE TABLE b (y UInt8)",
        ]);
        expect(result.statements).toBe(2);
    });

    /** Same reasoning as the Postgres empty-file case. */
    it("refuses a file that splits to nothing", async () => {
        const command = vi.fn();

        await expect(
            applyClickhouseSchema({ command }, ".", () => [], reads("-- only a comment\n")),
        ).rejects.toThrow(/contains no statements/);
        expect(command).not.toHaveBeenCalled();
    });

    /**
     * ClickHouse has no transactional DDL, so a mid-file failure must surface —
     * the earlier statements really are applied and the operator needs to know.
     */
    it("stops at the first failing statement and propagates it", async () => {
        const command = vi
            .fn()
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(new Error("Unknown data type"));
        const split = (s: string) => s.split(";");

        await expect(
            applyClickhouseSchema({ command }, ".", split, reads("ok;bad;never")),
        ).rejects.toThrow("Unknown data type");
        expect(command).toHaveBeenCalledTimes(2);
    });
});
