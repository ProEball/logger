import { describe, it, expect } from "vitest";
import { splitDdl, stripComments } from "./ddl";

describe("stripComments", () => {
    it("removes a whole-line comment", () => {
        expect(stripComments("-- a comment\nSELECT 1")).toBe("\nSELECT 1");
    });

    it("removes a trailing comment but keeps the code before it", () => {
        expect(stripComments("SELECT 1 -- why")).toBe("SELECT 1 ");
    });

    /**
     * The reason this function exists rather than a `/--.*$/` replace: the
     * schema's Enum8 and DEFAULT clauses hold quoted literals, and a `--`
     * inside one is data.
     */
    it("leaves `--` alone inside a string literal", () => {
        expect(stripComments("SELECT 'a--b'")).toBe("SELECT 'a--b'");
    });

    it("handles a comment after a string literal on the same line", () => {
        expect(stripComments("SELECT 'a' -- note")).toBe("SELECT 'a' ");
    });

    it("leaves a line with no comment untouched", () => {
        expect(stripComments("CREATE TABLE t (x UInt8)")).toBe("CREATE TABLE t (x UInt8)");
    });
});

describe("splitDdl", () => {
    it("splits on semicolons and trims", () => {
        expect(splitDdl("CREATE TABLE a (x UInt8);\n\nCREATE TABLE b (y UInt8);")).toEqual([
            "CREATE TABLE a (x UInt8)",
            "CREATE TABLE b (y UInt8)",
        ]);
    });

    it("keeps a final statement with no trailing semicolon", () => {
        expect(splitDdl("CREATE TABLE a (x UInt8)")).toEqual(["CREATE TABLE a (x UInt8)"]);
    });

    /**
     * A semicolon inside a comment used to be theoretical; the shipped
     * `core/clickhouse/schema.sql` is mostly prose explaining the two
     * irreversible choices, and prose has semicolons in it.
     */
    it("ignores a semicolon inside a comment", () => {
        expect(splitDdl("-- one thing; another\nCREATE TABLE a (x UInt8);")).toEqual([
            "CREATE TABLE a (x UInt8)",
        ]);
    });

    it("ignores a semicolon inside a string literal", () => {
        expect(splitDdl("CREATE TABLE a (x String DEFAULT 'p;q');")).toEqual([
            "CREATE TABLE a (x String DEFAULT 'p;q')",
        ]);
    });

    it("returns nothing for a file that is only comments or blank", () => {
        expect(splitDdl("-- nothing here\n\n")).toEqual([]);
        expect(splitDdl("")).toEqual([]);
        expect(splitDdl("  ;; ")).toEqual([]);
    });

    it("preserves the inner structure of a multi-line statement", () => {
        const [only] = splitDdl("CREATE TABLE a\n(\n    x UInt8,\n    y UInt8\n)\nENGINE = Log;");
        expect(only).toContain("x UInt8,");
        expect(only).toContain("ENGINE = Log");
    });
});
