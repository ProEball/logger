/**
 * The domain shape of an event, and the shape one is written in.
 *
 * **Hand-written since Phase 4** (`docs/features/09-clickhouse.md` §12.4).
 * Both types were `typeof events.$inferSelect` / `$inferInsert` off the Drizzle
 * `events` table; that table no longer exists, because events live in
 * ClickHouse and there is no Drizzle dialect for it.
 *
 * Writing them out is not a loss. Inferring a domain type from a storage
 * schema meant every `jsonb` column arrived as `unknown` and every component
 * that wanted to read one had to write `as Record<string, unknown>` — a cast
 * `PROJECT.md` §4 allows only with a reason, spent on working around a type
 * that was never accurate in the first place. The mapper that produces these
 * (`core/clickhouse/from-event-row.ts`) has always returned objects there.
 *
 * Lives in `shared/types/` rather than in `core/clickhouse/` on purpose: this
 * is the shape the application passes around, not the shape a store holds. The
 * two ClickHouse row shapes are `core/clickhouse/event-row.types.ts`, and the
 * whole job of the mappers on either side is that these two files do not have
 * to agree about anything but the values.
 */

/**
 * An event as every read surface receives it.
 *
 * `null` means "the field was not set", exactly as it did when this came out of
 * Postgres. ClickHouse has no `Nullable` column in this schema (§4.1), so the
 * mapper converts the empty string back — see `fromClickhouseRow`.
 */
export interface Event {
    id: string;
    projectId: string;
    timestamp: Date;
    level: string;
    message: string;

    source: string | null;
    environment: string | null;
    release: string | null;
    errorType: string | null;

    userId: string | null;
    sessionId: string | null;
    requestId: string | null;
    traceId: string | null;

    stackTrace: string | null;
    /** Never null: an event with no attributes has `{}`. */
    attributes: Record<string, unknown>;
    /** Never null, and already parsed — the column is an opaque `String`. */
    context: Record<string, unknown>;

    userAgent: string | null;
    ip: string | null;

    /**
     * The message-template fingerprint, folded into the signed range Postgres
     * used to store it in. The fold is a bijection, so it says nothing about
     * where the row lives — see `toUnsignedBigint`.
     */
    templateHash: bigint;
}

/**
 * An enriched event on its way to storage, as `enrichEvent` produces it.
 *
 * Not `Event` with the ids made optional. It carries one field `Event` does
 * not — `messageTemplate` — because the template text is computed from the
 * message by a TypeScript normaliser at ingest and cannot be derived in SQL,
 * while nothing on a read surface displays an individual event's template. See
 * §12.4 for why the template is stored on the row rather than in a registry
 * table.
 */
export interface NewEvent {
    id: string;
    projectId: string;
    timestamp: Date;
    level: string;
    message: string;

    source: string | null;
    environment: string | null;
    release: string | null;
    errorType: string | null;

    userId: string | null;
    sessionId: string | null;
    requestId: string | null;
    traceId: string | null;

    stackTrace: string | null;
    attributes: Record<string, string | number | boolean | null> | null;
    context: Record<string, unknown> | null;

    userAgent: string | null;
    ip: string | null;

    templateHash: bigint;
    /** `normalizeMessage(message)` — the grouping key's human-readable half. */
    messageTemplate: string;
}
