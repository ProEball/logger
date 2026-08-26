/**
 * The `insert_deduplication_token` for one ingest request, or `null` when the
 * request did not ask to be deduplicated.
 *
 * ## Why this is a header and not a hash of the payload
 *
 * `docs/features/09-clickhouse.md` §10 says "a token derived from the batch",
 * and that is wrong in a way worth writing down rather than quietly fixing.
 *
 * Experiment 6 measured what the token actually does: **it wins over the block
 * checksum.** A second insert carrying a token ClickHouse has already seen is
 * discarded *whatever it contains*. So a token derived from the request body
 * would deduplicate two genuinely different requests whenever their bodies
 * happen to match — and for a logging service they match constantly. A
 * heartbeat, a retry loop, the same error twice in a second: `{"level":"info",
 * "message":"tick"}` sent twice is two events, and content hashing would store
 * one and report success for both.
 *
 * Nor can the hash include anything server-side. The id and the arrival time
 * are what distinguish those two requests, and they are equally what
 * distinguishes a retry from its original — a token containing either
 * deduplicates nothing.
 *
 * So the client has to say. Only the caller knows whether a request is a new
 * batch or the same batch a second time, and an SDK retrying a timeout is
 * precisely the case where it knows. Absent the header the behaviour is
 * exactly today's: the events are stored, duplicates included.
 *
 * Losing events silently is strictly worse than storing a duplicate the user
 * can see — which is the same reason §10 chose `wait_for_async_insert = 1`.
 */

/** Long enough for a UUID or a ULID with room to spare; short enough that the
 *  value is bounded before it reaches a dedup hash kept on disk. */
export const MAX_IDEMPOTENCY_KEY_LENGTH = 128;

export const IDEMPOTENCY_HEADER = "idempotency-key";

/**
 * Scoped by project, because ClickHouse's deduplication window is a property
 * of the **table** (per partition), not of a tenant. Two projects choosing the
 * same key — `1`, `retry`, a request id from a shared gateway — would
 * otherwise silently swallow each other's events.
 */
export function dedupToken(projectId: string, key: string | null | undefined): string | null {
    if (key === null || key === undefined) return null;
    const trimmed = key.trim();
    if (trimmed === "" || trimmed.length > MAX_IDEMPOTENCY_KEY_LENGTH) return null;
    return `${projectId}:${trimmed}`;
}

/** Reads the idempotency key off a request, if it carries one. */
export function dedupTokenFromRequest(req: Request, projectId: string): string | null {
    return dedupToken(projectId, req.headers.get(IDEMPOTENCY_HEADER));
}
