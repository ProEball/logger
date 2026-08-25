/**
 * The bucket shapes both dashboards plot, and the pure arithmetic over them.
 *
 * **Separate from `shared/services/event-aggregations.service.ts` for a reason
 * the build enforces.** That module imports `@/core/db/client`, which imports
 * `postgres`, which imports `fs` — so a `"use client"` component importing a
 * *value* from it drags a Node-only driver into the browser bundle and the
 * production build fails outright. `OrgVolumeChart` is a client component and
 * needs `errorsIn`, so the helpers live here where nothing touches a database.
 *
 * Found by `npm run build` on 2026-08-25, not by review: the previous code
 * imported only a `type`, which is erased at compile time and hid the boundary.
 * Types cross freely; values do not. It is also the split `PROJECT.md` §7 asks
 * for on its own terms — pure functions in `utils/`, data access in `services/`.
 */

/**
 * One time bucket of one project: how many events, and how many were errors.
 *
 * `errors` is a field rather than something derived from a level breakdown, and
 * that is the whole point — see {@link LevelledBucket} for what asking for the
 * breakdown costs.
 */
export type EventBucket = {
    projectId: string;
    ts: Date;
    total: number;
    /** `error + fatal`, which is what both dashboards mean by "errors". */
    errors: number;
};

/**
 * A bucket that also carries counts per level.
 *
 * **Measurably more expensive, which is why it is a separate shape.** The rollup
 * stores `total` and a generated `errors` column, so {@link EventBucket} is a
 * plain column read. Per-level counts live in the `by_level` jsonb, and getting
 * them means `jsonb_each_text` — a JSON parse per row, and one output row per
 * level rather than per bucket.
 *
 * Benchmarked 2026-08-25 on a 500k-event corpus: the organization chart's bucket
 * query went from **3.96 ms to 33.6 ms** when a merge gave it the level
 * breakdown it does not draw. That is the same failure `event_template_rollup`
 * already documents — 547 ms at 0% I/O, pure CPU in the jsonb expansion — paid a
 * second time on a different table.
 *
 * So the two charts ask two different questions and it is not a distinction
 * worth collapsing: the organization plots an error *ratio* and needs two
 * numbers; the project dashboard plots a stacked area and needs all five.
 */
export type LevelledBucket = EventBucket & {
    /** Counts per level for this bucket. */
    byLevel: Record<string, number>;
};

/** `error + fatal`, read straight off the bucket. */
export function errorsIn(bucket: EventBucket): number {
    return bucket.errors;
}

/**
 * Whether a caller asked to narrow by environment.
 *
 * `undefined` and `[]` must both mean "no filter". An empty array reaching the
 * filtered branch would produce `environment = ANY(ARRAY[])`, which matches
 * nothing — every widget on the page would silently empty.
 */
export function hasEnvFilter(environments?: string[]): boolean {
    return !!environments && environments.length > 0;
}

/**
 * Insert zero rows for buckets that had no events, **per project**.
 *
 * The query returns only buckets that exist, so without this a gap in traffic
 * makes a line stop short instead of visibly dropping to zero — and on the org
 * chart, a project quiet for the whole range would have no line at all rather
 * than a flat one, reading as "deleted" instead of "idle".
 *
 * Boundaries are computed the same way as the SQL (epoch-floor to the width), so
 * filled timestamps land exactly on real ones. If the two ever diverged every
 * real bucket would be shadowed by a zero bucket one step away.
 *
 * Generic over the bucket shape, so a levelled series fills with `byLevel: {}`
 * and a plain one does not grow a field it never had.
 */
export function fillBuckets<T extends EventBucket>(
    buckets: T[],
    projectIds: string[],
    range: { from: Date; to: Date },
    bucketSecs: number,
    empty: (projectId: string, ts: Date) => T,
): T[] {
    const widthMs = bucketSecs * 1000;
    const first = Math.floor(range.from.getTime() / widthMs) * widthMs;
    // `to` is an exclusive bound, so the last bucket is the one holding to-1ms.
    const last = Math.floor((range.to.getTime() - 1) / widthMs) * widthMs;

    const present = new Map(buckets.map((b) => [`${b.projectId}@${b.ts.getTime()}`, b]));
    const filled: T[] = [];
    for (const projectId of projectIds) {
        for (let ts = first; ts <= last; ts += widthMs) {
            filled.push(present.get(`${projectId}@${ts}`) ?? empty(projectId, new Date(ts)));
        }
    }
    return filled;
}

/** The zero bucket for a plain series. */
export function emptyBucket(projectId: string, ts: Date): EventBucket {
    return { projectId, ts, total: 0, errors: 0 };
}

/** The zero bucket for a levelled series. */
export function emptyLevelledBucket(projectId: string, ts: Date): LevelledBucket {
    return { projectId, ts, total: 0, errors: 0, byLevel: {} };
}
