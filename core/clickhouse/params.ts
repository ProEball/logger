/**
 * Collects bound values for a ClickHouse query and hands back the placeholder
 * text to put in the SQL.
 *
 * **This is the security boundary, and it is deliberately the only way to get a
 * value into a query.** There is no Drizzle dialect for ClickHouse, so nothing
 * else in this repository stands between a string out of a URL and the SQL
 * text. A caller that cannot name a `{p:Type}` placeholder for a value has to
 * stop and think about it, which is the point.
 *
 * Names are positional (`p0`, `p1`, …) rather than derived from the field, so
 * the same value can appear twice — an attribute key is referenced by two
 * expressions, a bucket width by three — without a caller inventing unique
 * names. Two bags in one query would collide, so a query that needs its own
 * parameters alongside a compiled `WHERE` must either share the bag or use
 * names outside the `p<n>` space; `listEvents` does the latter with `cursor_ts`
 * and `cursor_id`.
 *
 * Extracted from `filter-compiler.ts` in Phase 4, when the dashboard
 * aggregations became a second thing that builds ClickHouse SQL by hand.
 */
export class ParamBag {
    readonly params: Record<string, unknown> = {};
    private next = 0;

    /**
     * Binds `value` and returns the placeholder to interpolate.
     *
     * `type` is a ClickHouse type name and is the one part of this that is
     * **not** caller data — it is written in the SQL by the module building the
     * query, never taken from a request.
     */
    add(value: unknown, type: string): string {
        const name = `p${this.next++}`;
        this.params[name] = value;
        return `{${name}:${type}}`;
    }
}
