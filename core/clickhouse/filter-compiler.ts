import type { EventFilters } from "@/shared/utils/event-filters.schema";
import { ParamBag } from "./params";
import { parseSearchQuery, type SearchQuery, type SearchTerm } from "./search-query";

/**
 * `EventFilters` compiled to a ClickHouse `WHERE` clause.
 *
 * There is no Drizzle dialect for ClickHouse, so this module is the thing
 * Drizzle was doing for the Postgres read path: it is the only place that knows
 * how a filter becomes SQL, and the only place that decides what a bound
 * parameter is.
 *
 * **It lives in `core/` because two features need it.** `features/events` reads
 * pages and facets; `features/alerts` counts matches for a rule. A feature may
 * not import another feature (`PROJECT.md` §2.1), and duplicating the compiler
 * is how the two Postgres implementations of `topMessages` came to disagree.
 *
 * ## Parameter binding is the security boundary
 *
 * Every user-supplied value goes through `query_params`. Not one is
 * interpolated, **including attribute keys** — an attribute path can be a bound
 * `getSubcolumn(attributes, {k:String})` rather than a piece of SQL text, which
 * was measured against the server before this was written (see
 * `lab/clickhouse/probe-query-shapes.mjs`). That removes the only place a
 * string from a URL would otherwise have had to be spliced into a query. See
 * `docs/reference/security.md`.
 *
 * The compiler emits placeholder names it generates itself (`p0`, `p1`, …), so
 * a caller adding its own parameters — `listEvents` and its cursor — must use
 * names outside that space.
 */

export interface CompiledQuery {
    /** A complete boolean expression, safe to place after `WHERE`. */
    where: string;
    /** Values for `query_params`, keyed by the placeholder names in `where`. */
    params: Record<string, unknown>;
}

/** The five fields the facet queries exclude one at a time. */
export type FacetField = "levels" | "environments" | "sources" | "releases" | "errorTypes";

export interface TimeWindow {
    from: Date;
    to: Date;
    /**
     * `timestamp < to` instead of `<= to`. The alert evaluator has always used
     * a half-open window; the events list has always used a closed one. The
     * difference is one millisecond and no user would see it, which is exactly
     * why it is a parameter — a silent change of boundary is the kind of thing
     * that is only ever noticed as an off-by-one months later.
     */
    toExclusive?: boolean;
}

export interface CompileOptions extends TimeWindow {
    /**
     * Fields whose own clause is left out. Used by the facet queries so a
     * field's own selection does not shrink its own counts.
     */
    exclude?: readonly FacetField[];
}

/**
 * Filter field → ClickHouse column.
 *
 * Tuples rather than an object because `Object.entries` widens its keys to
 * `string`, and recovering the field type from that needs an `as` — which
 * PROJECT.md §4 allows only with a reason, and "the standard library forgot"
 * is not one when a two-character change avoids it.
 */
const FACET_COLUMNS: ReadonlyArray<readonly [FacetField, string]> = [
    ["levels", "level"],
    ["environments", "environment"],
    ["sources", "source"],
    ["releases", "release"],
    ["errorTypes", "error_type"],
];

type CorrelationField = "userId" | "sessionId" | "requestId" | "traceId";

/** The four single-value correlation ids. */
const CORRELATION_COLUMNS: ReadonlyArray<readonly [CorrelationField, string]> = [
    ["userId", "user_id"],
    ["sessionId", "session_id"],
    ["requestId", "request_id"],
    ["traceId", "trace_id"],
];

function compileTerm(term: SearchTerm, bag: ParamBag): string | null {
    const parts: string[] = [];

    // `hasToken` is what the tokenbf_v1 index answers, and it *throws* on a
    // needle containing a separator or on an empty one — `messageTokens` exists
    // to make sure neither can reach it.
    for (const token of term.tokens) {
        parts.push(`hasToken(message_lower, ${bag.add(token, "String")})`);
    }

    // Adjacency, and the only predicate available for a term the tokenizer
    // found nothing in. `position` cannot use the index; the tokens above are
    // what narrow the scan it then runs over.
    if (term.phrase !== null) {
        parts.push(`position(message_lower, ${bag.add(term.phrase, "String")}) > 0`);
    }

    if (parts.length === 0) return null;

    const conjunction = parts.length === 1 ? parts[0] : `(${parts.join(" AND ")})`;
    return term.negated ? `NOT ${conjunction}` : conjunction;
}

function compileSearch(query: SearchQuery, bag: ParamBag): string | null {
    const groups: string[] = [];

    for (const group of query.orGroups) {
        const compiled = group
            .map((term) => compileTerm(term, bag))
            .filter((part): part is string => part !== null);
        if (compiled.length > 0) groups.push(compiled.join(" AND "));
    }

    if (groups.length === 0) return null;
    if (groups.length === 1) return groups[0];
    return `(${groups.map((group) => `(${group})`).join(" OR ")})`;
}

function compileAttribute(key: string, value: string, bag: ParamBag): string {
    const path = () => `getSubcolumn(attributes, ${bag.add(key, "String")})`;
    const clauses: string[] = [];

    // `toString` of a path no row has is `''`, so an equality test against the
    // empty string would match every event that never carried the key at all.
    // Only that one value needs the existence check, and only it pays for the
    // second subcolumn read.
    if (value === "") {
        clauses.push(`dynamicType(${path()}) != 'None'`);
    }

    // Compared as text on purpose. Postgres used `attributes @> '{"k":"v"}'`,
    // which is type-strict: a filter on a numeric attribute (`retries=2`)
    // matched nothing at all, because the URL only ever carries strings. Here
    // the stored 2 and the typed "2" agree.
    clauses.push(`toString(${path()}) = ${bag.add(value, "String")}`);

    return clauses.length === 1 ? clauses[0] : `(${clauses.join(" AND ")})`;
}

/**
 * Build the `WHERE` clause for one project's events.
 *
 * The time window is a parameter rather than being resolved from
 * `filters.range` here: the alert evaluator's window comes from the rule's
 * condition and has nothing to do with the range stored on the filter.
 */
export function compileFilters(
    projectId: string,
    filters: EventFilters,
    options: CompileOptions,
): CompiledQuery {
    const bag = new ParamBag();
    const exclude = options.exclude ?? [];
    const clauses: string[] = [
        `project_id = ${bag.add(projectId, "UUID")}`,
        `timestamp >= ${bag.add(options.from, "DateTime64(3, 'UTC')")}`,
        `timestamp ${options.toExclusive ? "<" : "<="} ${bag.add(options.to, "DateTime64(3, 'UTC')")}`,
    ];

    for (const [field, column] of FACET_COLUMNS) {
        if (exclude.includes(field)) continue;
        const values = filters[field];
        if (!values?.length) continue;
        // An Enum8 compares against Array(String) directly, and an unknown
        // member is simply never equal rather than an error — measured, because
        // `parse-filters.ts` lets any string through for the other four.
        clauses.push(`${column} IN ${bag.add(values, "Array(String)")}`);
    }

    for (const [field, column] of CORRELATION_COLUMNS) {
        const value = filters[field];
        if (!value) continue;
        clauses.push(`${column} = ${bag.add(value, "String")}`);
    }

    if (filters.message) {
        const search = compileSearch(parseSearchQuery(filters.message), bag);
        if (search) clauses.push(search);
    }

    for (const { key, value } of filters.attributes ?? []) {
        clauses.push(compileAttribute(key, value, bag));
    }

    return { where: clauses.join(" AND "), params: bag.params };
}
