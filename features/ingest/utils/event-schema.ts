import { z } from "zod";

const MAX_STACK_TRACE_LENGTH = 32 * 1024; // 32 KB

export const VALID_LEVELS = ["debug", "info", "warn", "error", "fatal"] as const;
export type EventLevel = (typeof VALID_LEVELS)[number];

export const eventSchema = z.object({
    level: z.enum(VALID_LEVELS),
    message: z.string().min(1).max(2048),
    timestamp: z.string().datetime({ offset: true }).optional(),
    source: z.string().max(256).optional(),
    environment: z.string().max(128).optional(),
    release: z.string().max(256).optional(),
    user_id: z.string().max(256).optional(),
    session_id: z.string().max(256).optional(),
    request_id: z.string().max(256).optional(),
    trace_id: z.string().max(256).optional(),
    error_type: z.string().max(256).optional(),
    stack_trace: z
        .string()
        .max(MAX_STACK_TRACE_LENGTH, "stack_trace exceeds 32 KB limit")
        .optional(),
    attributes: z
        .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
        .optional()
        .default({}),
    context: z.record(z.string(), z.unknown()).optional().default({}),
});

export type IngestEvent = z.infer<typeof eventSchema>;

export const batchEventSchema = z.array(eventSchema).min(1).max(500);
export type BatchIngestEvent = z.infer<typeof batchEventSchema>;
