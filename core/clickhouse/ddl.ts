/**
 * Splitting a ClickHouse schema file into statements.
 *
 * ClickHouse's HTTP interface takes **one** statement per request, so the
 * schema file cannot be handed over whole the way `db/schema.sql` is handed to
 * Postgres's simple protocol. That makes this splitter the thing standing
 * between a readable, commented DDL file and a pile of one-liners.
 *
 * Kept pure and separate from the client so it is unit-testable with no
 * container running — one of the few pieces of the ClickHouse path that can be
 * (docs/features/09-clickhouse.md §11).
 */

/**
 * Strips `--` line comments, ignoring `--` inside a single-quoted literal.
 *
 * The literals matter: `Enum8('debug' = 1, …)` is fine, but a default or a
 * comment string containing `--` would otherwise truncate the statement, and
 * the result would be a syntax error a long way from its cause.
 */
export function stripComments(sql: string): string {
    return sql
        .split("\n")
        .map((line) => {
            let inString = false;
            for (let i = 0; i < line.length; i++) {
                if (line[i] === "'") {
                    inString = !inString;
                    continue;
                }
                if (!inString && line[i] === "-" && line[i + 1] === "-") {
                    return line.slice(0, i);
                }
            }
            return line;
        })
        .join("\n");
}

/**
 * Splits a schema file into executable statements.
 *
 * Comments are removed first, so a `;` inside one cannot end a statement, and
 * the statements handed to ClickHouse stay short enough to read in an error
 * message. Semicolons inside string literals are respected.
 */
export function splitDdl(sql: string): string[] {
    const withoutComments = stripComments(sql);
    const statements: string[] = [];
    let current = "";
    let inString = false;

    for (const char of withoutComments) {
        if (char === "'") inString = !inString;

        if (char === ";" && !inString) {
            statements.push(current.trim());
            current = "";
            continue;
        }

        current += char;
    }

    const trailing = current.trim();
    if (trailing !== "") statements.push(trailing);

    return statements.filter((s) => s !== "");
}
