import { z } from "zod";

export const EVENT_LEVELS = ["debug", "info", "warn", "error", "fatal"] as const;
export const TIME_RANGE_PRESETS = ["15m", "1h", "6h", "24h", "7d", "30d"] as const;

export const timeRangePresetSchema = z.enum(TIME_RANGE_PRESETS);

export const timeRangeSchema = z.discriminatedUnion("type", [
    z.object({ type: z.literal("preset"), value: timeRangePresetSchema }),
    z.object({
        type: z.literal("custom"),
        from: z.string().datetime({ offset: true }),
        to: z.string().datetime({ offset: true }),
    }),
]);

export const attributeFilterSchema = z.object({
    key: z.string(),
    value: z.string(),
});

export const eventFiltersSchema = z.object({
    range: timeRangeSchema,
    levels: z.array(z.enum(EVENT_LEVELS)).optional(),
    environments: z.array(z.string()).optional(),
    sources: z.array(z.string()).optional(),
    releases: z.array(z.string()).optional(),
    errorTypes: z.array(z.string()).optional(),
    userId: z.string().optional(),
    sessionId: z.string().optional(),
    requestId: z.string().optional(),
    traceId: z.string().optional(),
    message: z.string().optional(),
    attributes: z.array(attributeFilterSchema).optional(),
});

export type TimeRangePreset = z.infer<typeof timeRangePresetSchema>;
export type TimeRange = z.infer<typeof timeRangeSchema>;
export type AttributeFilter = z.infer<typeof attributeFilterSchema>;
export type EventFilters = z.infer<typeof eventFiltersSchema>;
