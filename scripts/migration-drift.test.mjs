import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
    driftMessage,
    isMissingMigrationsTable,
    pendingMigrations,
    readJournalEntries,
    readLastAppliedAt,
} from "./migration-drift.mjs";

const MIGRATIONS_FOLDER = "./core/db/migrations";

/** Three entries with a deliberate gap between the stamps. */
const ENTRIES = [
    { idx: 0, when: 100, tag: "0000_first" },
    { idx: 1, when: 200, tag: "0001_second" },
    { idx: 2, when: 300, tag: "0002_third" },
];

describe("readJournalEntries", () => {
    it("reads the real journal and returns entries oldest-first", () => {
        const entries = readJournalEntries(MIGRATIONS_FOLDER);

        expect(entries.length).toBeGreaterThan(0);
        const stamps = entries.map((e) => e.when);
        expect(stamps).toEqual([...stamps].sort((a, b) => a - b));
    });

    it("matches the .sql files on disk one-for-one", () => {
        const entries = readJournalEntries(MIGRATIONS_FOLDER);
        const files = readdirSync(MIGRATIONS_FOLDER)
            .filter((name) => name.endsWith(".sql"))
            .map((name) => name.slice(0, -".sql".length))
            .sort();

        expect(entries.map((e) => e.tag).sort()).toEqual(files);
    });
});

describe("pendingMigrations", () => {
    it("returns everything when nothing has ever been applied", () => {
        expect(pendingMigrations(ENTRIES, null).map((e) => e.tag)).toEqual([
            "0000_first",
            "0001_second",
            "0002_third",
        ]);
    });

    it("returns nothing when the watermark is the newest entry", () => {
        expect(pendingMigrations(ENTRIES, 300)).toEqual([]);
    });

    it("treats the watermark as applied, not pending", () => {
        // The migrator's test is `created_at < when`, so an entry stamped
        // exactly at the watermark has already run. Off-by-one here would
        // re-run a migration on every check.
        expect(pendingMigrations(ENTRIES, 200).map((e) => e.tag)).toEqual(["0002_third"]);
    });

    it("returns the tail for a watermark between two entries", () => {
        expect(pendingMigrations(ENTRIES, 250).map((e) => e.tag)).toEqual(["0002_third"]);
    });

    it("returns everything for a watermark older than the first entry", () => {
        expect(pendingMigrations(ENTRIES, 1).map((e) => e.tag)).toEqual([
            "0000_first",
            "0001_second",
            "0002_third",
        ]);
    });

    it("sorts unordered input before comparing", () => {
        const shuffled = [ENTRIES[2], ENTRIES[0], ENTRIES[1]];

        expect(pendingMigrations(shuffled, 100).map((e) => e.tag)).toEqual([
            "0001_second",
            "0002_third",
        ]);
    });

    it("handles an empty journal", () => {
        expect(pendingMigrations([], null)).toEqual([]);
    });
});

describe("isMissingMigrationsTable", () => {
    it("recognises undefined_table", () => {
        expect(isMissingMigrationsTable({ code: "42P01" })).toBe(true);
    });

    it("recognises invalid_schema_name — a never-migrated database", () => {
        expect(isMissingMigrationsTable({ code: "3F000" })).toBe(true);
    });

    it("does not swallow an authentication failure", () => {
        expect(isMissingMigrationsTable({ code: "28P01" })).toBe(false);
    });

    it("does not swallow a connection failure", () => {
        expect(isMissingMigrationsTable({ code: "ECONNREFUSED" })).toBe(false);
    });

    it("is false for an error with no code, and for nothing at all", () => {
        expect(isMissingMigrationsTable(new Error("boom"))).toBe(false);
        expect(isMissingMigrationsTable(undefined)).toBe(false);
        expect(isMissingMigrationsTable(null)).toBe(false);
    });
});

describe("readLastAppliedAt", () => {
    /** Stand-in for the postgres.js tagged template — the system boundary. */
    const sqlReturning = (rows) => async () => rows;
    const sqlThrowing = (err) => async () => {
        throw err;
    };

    it("returns the newest stamp as a number", async () => {
        // postgres.js hands back bigint columns as strings.
        await expect(readLastAppliedAt(sqlReturning([{ created_at: "1787603164031" }]))).resolves.toBe(
            1787603164031,
        );
    });

    it("returns null when the table exists but is empty", async () => {
        await expect(readLastAppliedAt(sqlReturning([]))).resolves.toBeNull();
    });

    it("returns null when the migrations schema is absent", async () => {
        await expect(readLastAppliedAt(sqlThrowing({ code: "3F000" }))).resolves.toBeNull();
    });

    it("rethrows anything that is not a missing table", async () => {
        await expect(readLastAppliedAt(sqlThrowing({ code: "28P01" }))).rejects.toEqual({
            code: "28P01",
        });
    });
});

describe("driftMessage", () => {
    const target = { label: "logger_test", remedy: "npm run db:migrate:e2e" };

    it("names every pending tag and the remedy", () => {
        const message = driftMessage(ENTRIES.slice(1), target);

        expect(message).toContain("logger_test is 2 migrations behind");
        expect(message).toContain("0001_second, 0002_third");
        expect(message).toContain("npm run db:migrate:e2e");
    });

    it("uses the singular for one migration", () => {
        expect(driftMessage(ENTRIES.slice(2), target)).toContain("is 1 migration behind");
    });
});
