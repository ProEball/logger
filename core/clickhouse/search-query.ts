/**
 * The message search box, parsed.
 *
 * Postgres answered `filters.message` with
 * `to_tsvector('simple', message) @@ websearch_to_tsquery('simple', $q)`.
 * ClickHouse has no equivalent, so the grammar `websearch_to_tsquery`
 * implements — bare words AND-ed, `"quoted phrases"`, `-negation`, and `or` —
 * is parsed here and compiled to `hasToken` / `position` predicates in
 * `filter-compiler.ts`. See `docs/features/09-clickhouse.md` §5.
 *
 * **This half is deliberately pure and knows no SQL.** A parser that emitted
 * strings could only be tested by asserting on strings, which is the shape of
 * test that passes while the meaning is wrong. A tree can be asserted on
 * directly, and the compiler's job shrinks to a mechanical walk of it.
 *
 * ## Where it does not match Postgres, on purpose
 *
 * - A term of **two or more tokens** additionally requires the literal text —
 *   `foo_bar` matches `foo_bar`, not `foo bar`, where Postgres' `<->` accepts
 *   both. Searching for a hyphenated or underscored identifier and getting the
 *   identifier is what people mean.
 * - A term ClickHouse's tokenizer finds **no** tokens in (`+++`, `-->`) becomes
 *   a plain substring test. Postgres produced an empty tsquery, which matches
 *   nothing at all.
 * - A **single-token** term is matched by its token alone, so trailing
 *   punctuation (`timeout.`) behaves exactly as Postgres did. This is the case
 *   the rule above must not break.
 */

/**
 * Splits text the way ClickHouse's default tokenizer does — which is what the
 * `tokenbf_v1` index on `message_lower` is built from, so anything else would
 * pass `hasToken` a needle the server rejects outright (`BAD_ARGUMENTS: Needle
 * must not contain whitespace or separator characters`) and 500 the events
 * page.
 *
 * Measured against the server on 2026-08-26, not assumed: a token character is
 * an ASCII letter or digit, **or any code point at or above U+0080**. So `_`,
 * `-` and `.` split (`foo_bar` is two tokens), while `café`, `привет`, `a—b`
 * and `a😀b` are each one. The integration suite checks this agreement against
 * `tokens()` on a battery of inputs, because a disagreement is a 500 rather
 * than a wrong answer.
 *
 * Lowercasing is JavaScript's, against the column's `lowerUTF8`. They differ on
 * code points whose lowercase form has a different length — Turkish `İ` is the
 * usual example — where the result is a term that matches nothing rather than
 * an error.
 */
const ASCII_ZERO = 0x30;
const ASCII_NINE = 0x39;
const ASCII_UPPER_A = 0x41;
const ASCII_UPPER_Z = 0x5a;
const ASCII_LOWER_A = 0x61;
const ASCII_LOWER_Z = 0x7a;
/** Everything at or above this is a token character to ClickHouse. */
const FIRST_NON_ASCII = 0x80;

function isTokenChar(code: number): boolean {
    return (
        (code >= ASCII_ZERO && code <= ASCII_NINE) ||
        (code >= ASCII_UPPER_A && code <= ASCII_UPPER_Z) ||
        (code >= ASCII_LOWER_A && code <= ASCII_LOWER_Z) ||
        code >= FIRST_NON_ASCII
    );
}

export function messageTokens(text: string): string[] {
    // Written as a scan rather than a regexp so the rule above is legible as
    // the rule, and so the two surrogate halves of an astral character — both
    // above U+0080 — need no special case.
    const lower = text.toLowerCase();
    const tokens: string[] = [];
    let start = -1;

    for (let i = 0; i <= lower.length; i++) {
        const inToken = i < lower.length && isTokenChar(lower.charCodeAt(i));
        if (inToken && start === -1) start = i;
        else if (!inToken && start !== -1) {
            tokens.push(lower.slice(start, i));
            start = -1;
        }
    }

    return tokens;
}

export interface SearchTerm {
    /** Lowercased tokens, each safe to pass to `hasToken`. May be empty. */
    tokens: string[];
    /**
     * Lowercased literal the message must contain, or `null` when the single
     * token above already says it. Carries adjacency for a phrase.
     */
    phrase: string | null;
    negated: boolean;
}

export interface SearchQuery {
    /** OR of AND-groups. Empty means the search adds no constraint. */
    orGroups: SearchTerm[][];
}

interface RawPart {
    text: string;
    quoted: boolean;
    negated: boolean;
}

const WHITESPACE = /\s/;

/**
 * Cuts the raw query into quoted phrases and bare words, noting negation.
 *
 * An unterminated quote runs to the end of the input, matching Postgres. Only a
 * leading `-` negates; `a-b` is one word.
 */
function splitParts(input: string): RawPart[] {
    const parts: RawPart[] = [];
    let i = 0;

    while (i < input.length) {
        if (WHITESPACE.test(input[i])) {
            i++;
            continue;
        }

        let negated = false;
        while (i < input.length && input[i] === "-") {
            negated = true;
            i++;
        }
        if (i >= input.length) break;

        if (input[i] === '"') {
            i++;
            const end = input.indexOf('"', i);
            const text = end === -1 ? input.slice(i) : input.slice(i, end);
            i = end === -1 ? input.length : end + 1;
            parts.push({ text, quoted: true, negated });
            continue;
        }

        let end = i;
        while (end < input.length && !WHITESPACE.test(input[end]) && input[end] !== '"') end++;
        parts.push({ text: input.slice(i, end), quoted: false, negated });
        i = end;
    }

    return parts;
}

function toTerm(part: RawPart): SearchTerm | null {
    const text = part.text.toLowerCase();
    const tokens = messageTokens(part.text);

    // Nothing to ask for: `""`, or a run of `-` with no word after it.
    if (tokens.length === 0 && text.trim() === "") return null;

    return {
        tokens,
        phrase: tokens.length === 1 ? null : text,
        negated: part.negated,
    };
}

/**
 * Parse a search box into an OR of AND-groups.
 *
 * Never throws — this string comes straight out of a URL. Anything it cannot
 * make sense of degrades to fewer constraints, never to an error, which is the
 * same rule `parse-filters.ts` follows.
 *
 * `or` binds looser than the implicit AND, as in `websearch_to_tsquery`:
 * `a b or c` is `(a AND b) OR c`. A quoted `"or"` and a negated `-or` are
 * ordinary terms.
 */
export function parseSearchQuery(input: string): SearchQuery {
    const groups: SearchTerm[][] = [[]];

    for (const part of splitParts(input)) {
        if (!part.quoted && !part.negated && part.text.toLowerCase() === "or") {
            // A leading, trailing or doubled `or` joins nothing; Postgres
            // tolerates all three rather than failing the query.
            if (groups[groups.length - 1].length > 0) groups.push([]);
            continue;
        }

        const term = toTerm(part);
        if (term) groups[groups.length - 1].push(term);
    }

    return { orGroups: groups.filter((group) => group.length > 0) };
}
