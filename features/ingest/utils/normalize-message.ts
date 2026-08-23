/**
 * Collapses the machine-generated variability out of a log message, so that
 * events describing the same *kind* of thing share one key.
 *
 * `User u_487 signed in` and `User u_912 signed in` are one problem seen twice.
 * Grouping raw text says they are two, and on staging that is what turned
 * `topMessages` into 1,133,715 groups over seven days. See `PLAN.md` §16.3.
 *
 * **This is deliberately a shape matcher, not a parser.** Every rule below
 * matches a *form* — a UUID, a digit run, a token with an underscore — and
 * none of them reads the message. That is what makes it survive contact with a
 * multi-tenant install: the same rules apply to nginx, Postgres, a Java stack
 * trace and a line of Russian prose, because none of them depends on the
 * message being English or even on it having spaces.
 *
 * ## What it cannot do
 *
 * It removes **machine** variability. It does nothing about **semantic**
 * variability, and the difference is not fixable here:
 *
 * - `Connection to primary failed` / `Connection to replica failed`
 * - `User Alice signed in` / `User Bob signed in`
 * - `Пользователь Иванов вошёл` / `Пользователь Петров вошёл`
 *
 * A name, a role, a hostname and a column name have no form that distinguishes
 * them from the words around them. Each distinct value stays its own group, and
 * no regex will change that — only the author of the application knows which
 * word was the variable. That is the case for an explicit fingerprint field,
 * not an argument for a cleverer rule.
 *
 * It also **under-collapses on purpose** in one place: short bare numbers are
 * kept, because `returned 503` and `returned 500` are different problems rather
 * than two instances of one. The same choice keeps `Retry 1 of 3` and
 * `Retry 2 of 3` apart, which is wrong. Distinguishing the two cases requires
 * reading the sentence, so the rule picks the side where a mistake is cheaper:
 * two groups that should be one is noise, while one group that should be two
 * hides a distinction the operator needed.
 */

/**
 * Bumped whenever a rule changes. Hashes from different versions describe
 * different groupings and must never be compared or summed — without this,
 * changing a rule silently splits every existing group in two and the rollup
 * reports a cliff that never happened.
 */
export const NORMALIZER_VERSION = 1;

/** What every removed value becomes. */
const PLACEHOLDER = "***";

/**
 * Grouping happens on the first 200 characters, so normalising more is work
 * whose result is discarded.
 */
const MAX_LENGTH = 200;

/**
 * Unicode-aware boundaries. `\b` in JavaScript is defined over `[A-Za-z0-9_]`,
 * so in `Пользователь u_487 вошёл` it behaves by accident and in a script
 * without spaces it does not behave at all. These lookarounds ask the real
 * question — "is the neighbour a letter or a digit in any script".
 */
const B = String.raw`(?<![\p{L}\p{Nd}])`;
const E = String.raw`(?![\p{L}\p{Nd}])`;

type Rule = { readonly name: string; readonly re: RegExp };

/**
 * Order is load-bearing, not stylistic: the longest and most specific shapes
 * must match first. Put the digit-run rule ahead of the UUID rule and a UUID is
 * eaten piecemeal, so the UUID rule never matches anything again.
 */
const RULES: readonly Rule[] = [
    { name: "uuid", re: new RegExp(String.raw`${B}[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}${E}`, "giu") },
    { name: "timestamp", re: /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?/gu },
    { name: "email", re: /\S+@\S+\.\p{L}{2,}/gu },
    { name: "ipv4", re: new RegExp(String.raw`${B}\d{1,3}(?:\.\d{1,3}){3}${E}`, "gu") },
    { name: "url", re: /\p{L}[\p{L}\p{Nd}+.-]*:\/\/\S+/gu },
    // A path segment that is a number or a hex blob: /users/4821/orders.
    // Only inside a real path: the numeric segment must follow another one.
    // Without that the rule ate the 2 in `HTTP/2`, which is part of a name
    // rather than a resource id. Caught by a test, not in production.
    {
        name: "path-id",
        re: new RegExp(
            String.raw`(?<=/[\p{L}\p{Nd}._-]{1,64})/(?:\p{Nd}+|[0-9a-f]{8,})(?=[/\s?#]|$)`,
            "giu",
        ),
    },
    { name: "hex", re: new RegExp(String.raw`${B}[0-9a-f]{8,}${E}`, "giu") },
    // A prefixed identifier: u_487, sess_ai6h2q, req-9f2. Requires a separator
    // and at least one digit, so `read_only` and `signed_in` are left alone.
    { name: "id-token", re: new RegExp(String.raw`${B}\p{L}[\p{L}\p{Nd}]*[_-][\p{L}\p{Nd}]*\p{Nd}[\p{L}\p{Nd}]*${E}`, "gu") },
    // A number carrying a unit, written without a space: 2417ms, 872мс, 15s.
    // Script-independent by construction, which a list of English suffixes
    // would not have been.
    { name: "measure", re: /\p{Nd}+(?:[.,]\p{Nd}+)?\p{L}+/gu },
    // Long bare numbers. Four digits is the line: it keeps HTTP status codes
    // and small counts, and removes ids, sizes and epoch values.
    { name: "long-number", re: /\p{Nd}{4,}/gu },
];

/**
 * Replace every value-shaped token in `message` with `***`.
 *
 * Pure and total: any string in, a string out, no throwing. Runs on the ingest
 * path, so it does bounded work — ten passes over at most 200 characters.
 */
export function normalizeMessage(message: string): string {
    let out = message.slice(0, MAX_LENGTH);
    for (const rule of RULES) {
        out = out.replace(rule.re, PLACEHOLDER);
    }
    return out;
}

/** The rule names, in the order they are applied. Exposed for tests. */
export const NORMALIZER_RULES: readonly string[] = RULES.map((r) => r.name);

/**
 * A stable 64-bit fingerprint of a message's template.
 *
 * FNV-1a, written out rather than taken from a dependency, because this value
 * is **persisted**: every row in `event_template_rollup` is keyed by it, so the
 * function must produce the same number next year, on another Node version, on
 * another architecture. A hand-written integer loop has no version to drift.
 *
 * **The normalizer version is folded into the input, not stored beside it.**
 * Rules change; when they do, the same message yields a different template and
 * therefore must yield a different key. Mixing generations under one key would
 * merge two different groupings and report a change in the data that never
 * happened. Folding the version in makes that impossible rather than merely
 * discouraged — old rows keep their old keys, new rows get new ones, and the
 * two never silently add up.
 *
 * Returned as a `bigint` because Postgres `bigint` is what stores it, and
 * `number` cannot hold 64 bits without losing the low ones.
 */
export function templateHash(message: string): bigint {
    return hash64(`${NORMALIZER_VERSION}\u0000${normalizeMessage(message)}`);
}

/** FNV-1a over UTF-16 code units, 64-bit, wrapped to an unsigned range. */
function hash64(input: string): bigint {
    // `BigInt("…")` rather than a `123n` literal: `tsconfig.json` targets
    // ES2017, where the literal form is a compile error. Raising the target for
    // one function would change output for the whole application, which is a
    // much larger decision than this hash deserves.
    const PRIME = BigInt("1099511628211");
    const MASK = BigInt("18446744073709551615");
    let h = BigInt("14695981039346656037");

    // Hashing code units rather than bytes: JavaScript strings *are* code
    // units, so this needs no encoder and cannot disagree with one.
    for (let i = 0; i < input.length; i++) {
        h = ((h ^ BigInt(input.charCodeAt(i))) * PRIME) & MASK;
    }
    return h;
}

/**
 * Postgres `bigint` is signed, so the unsigned 64-bit value has to be folded
 * into the signed range before it is stored.
 *
 * A bijection from `[0, 2^64)` onto `[-2^63, 2^63)`, so it introduces no
 * collisions: two templates that hashed differently still store differently.
 * It is **not** an involution — applying it to an already-folded value returns
 * that value unchanged — so it must be applied exactly once, on the way in.
 */
export function toSignedBigint(value: bigint): bigint {
    const TWO_63 = BigInt("9223372036854775808");
    const TWO_64 = BigInt("18446744073709551616");
    return value >= TWO_63 ? value - TWO_64 : value;
}

/** The value actually written to `events.template_hash`. */
export function templateHashForStorage(message: string): bigint {
    return toSignedBigint(templateHash(message));
}
