import { z } from "zod";

const MAX_STACK_TRACE_LENGTH = 32 * 1024; // 32 KB

export const VALID_LEVELS = ["debug", "info", "warn", "error", "fatal"] as const;
export type EventLevel = (typeof VALID_LEVELS)[number];

/**
 * An optional free-text field, where blank means absent.
 *
 * **The ClickHouse schema has no `Nullable` column** — a Nullable maintains a
 * separate mask per column and blocks optimizations, so §4.1 of
 * docs/features/09-clickhouse.md stores "not supplied" as the empty string.
 * That makes `environment: ""` and a missing `environment` the same row, while
 * Postgres stored them as two distinct values and showed `''` as its own entry
 * in the filter bar beside `(unset)`.
 *
 * Collapsing them here rather than in the mapper means both stores agree for
 * as long as both exist, which is what makes the two comparable row for row
 * during the dual write.
 *
 * **Normalised, not rejected.** The alternative — `.min(1)`, a 400 — throws
 * away an event because a caller sent an empty string for a field it did not
 * have to send at all. For an ingest endpoint a dropped event is the worse
 * failure, and the value being discarded carries no information either way.
 * Same call as the `X-Forwarded-For` guard in `to-clickhouse-row.ts`.
 */
const optionalText = (max: number, message?: string) =>
    z
        .string()
        .max(max, message)
        .optional()
        .transform((value) => (value === undefined || value.trim() === "" ? undefined : value));

export const eventSchema = z.object({
    level: z.enum(VALID_LEVELS),
    // Not `optionalText`: the message *is* the event, so a blank one is a
    // client bug worth reporting rather than a field left unset.
    message: z.string().min(1).max(2048),
    timestamp: z.string().datetime({ offset: true }).optional(),
    source: optionalText(256),
    environment: optionalText(128),
    release: optionalText(256),
    user_id: optionalText(256),
    session_id: optionalText(256),
    request_id: optionalText(256),
    trace_id: optionalText(256),
    error_type: optionalText(256),
    stack_trace: optionalText(MAX_STACK_TRACE_LENGTH, "stack_trace exceeds 32 KB limit"),
    attributes: z
        .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
        .optional()
        .default({}),
    context: z.record(z.string(), z.unknown()).optional().default({}),
});

export type IngestEvent = z.infer<typeof eventSchema>;

export const batchEventSchema = z.array(eventSchema).min(1).max(500);
export type BatchIngestEvent = z.infer<typeof batchEventSchema>;
