/**
 * Builds the cache key for a cached read.
 *
 * Its whole job is to be exactly as discriminating as the query it stands in
 * for — no more, no less. Both errors are real:
 *
 * - **Too coarse** and one reader is served another's answer. The `scope` — the
 *   project ids a read is allowed to see — is the part that matters, because it
 *   is the permission boundary.
 * - **Too fine** and the key never repeats, which is the failure a resolved
 *   `Date` range produces: a cache with a 0% hit rate looks like it works and
 *   does nothing at all. Keys are built from range **presets**, never from
 *   resolved timestamps.
 *
 * Normalisation mirrors what the SQL does with each input:
 *
 * - `undefined` and `[]` collapse together, because a service builds no filter
 *   clause for either. Keeping them distinct would compute one answer under two
 *   keys.
 * - Order is dropped, because the clauses are `= ANY(...)`. `["a","b"]` and
 *   `["b","a"]` are one question, and a project list arrives from a query with
 *   no `ORDER BY`, so its order is not guaranteed stable between calls.
 * - Duplicates are dropped, for the same reason.
 *
 * Parts are serialised with `JSON.stringify` rather than joined by a separator.
 * Environment and source names are arbitrary user-supplied strings that reach
 * this from the ingest API, so a separator can appear *inside* a value: joined
 * on "|", the single environment `a|b` and the pair `["a","b"]` produce one key
 * for two different questions. That is a filter bypass, not a cosmetic
 * collision.
 *
 * Lives in `shared/` because the org overview and the project dashboard both
 * cache reads, and a second copy of a function whose job is an authorization
 * boundary is the last thing this repository needs — see `PROJECT.md` §2.2 for
 * the count of what copying has already cost it.
 */

/** Anything a key may be built from. Arrays are order- and duplicate-insensitive. */
export type CacheKeyPart = string | number | boolean | null | undefined | readonly string[];

/** Sorted, de-duplicated copy. The caller's array is never touched. */
function normalizeList(values: readonly string[]): string[] {
    return [...new Set(values)].sort();
}

function normalize(part: CacheKeyPart): string | number | boolean | null | readonly string[] {
    if (part === undefined || part === null) return null;
    // An empty filter list and an absent one are the same question — a service
    // builds no clause for either — so they must not produce two keys for one
    // answer. Collapsing both to null is safe because parts are positional: an
    // absent preset and an empty environment filter sit in different slots.
    if (Array.isArray(part)) return part.length === 0 ? null : normalizeList(part);
    return part;
}

/**
 * @param fn     which query this is — keeps two queries with identical
 *               arguments apart.
 * @param scope  the project ids this read may see. Always present, never
 *               optional: it is the permission boundary.
 * @param parts  everything else that changes the answer, in a fixed order.
 */
export function queryCacheKey(
    fn: string,
    scope: readonly string[],
    ...parts: CacheKeyPart[]
): string {
    return JSON.stringify([fn, normalizeList(scope), ...parts.map(normalize)]);
}
