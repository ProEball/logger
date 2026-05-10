import { z } from "zod";
import { eventFiltersSchema } from "@/shared/utils/event-filters.schema";

export { eventFiltersSchema };
export type { EventFilters } from "@/shared/utils/event-filters.schema";

export const conditionSchema = z.object({
    type: z.literal("threshold"),
    count: z.number().int().positive(),
    windowMinutes: z.number().int().min(1).max(1440),
});

export type AlertCondition = z.infer<typeof conditionSchema>;

export const webhookChannelSchema = z.object({
    type: z.literal("webhook"),
    url: z.string().url("Invalid webhook URL"),
    headers: z
        .array(z.object({ key: z.string().min(1), value: z.string() }))
        .optional(),
});

export const channelsSchema = z
    .array(webhookChannelSchema)
    .min(1, "At least one channel is required");

export type WebhookChannel = z.infer<typeof webhookChannelSchema>;
export type AlertChannel = z.infer<typeof channelsSchema>[number];

export const createAlertRuleSchema = z.object({
    name: z.string().min(1).max(256),
    description: z.string().max(1024).optional(),
    filter: eventFiltersSchema,
    condition: conditionSchema,
    channels: channelsSchema,
    notifyOnResolve: z.boolean().default(true),
});

export type CreateAlertRuleInput = z.infer<typeof createAlertRuleSchema>;

export const updateAlertRuleSchema = createAlertRuleSchema.partial().extend({
    id: z.string().uuid(),
});

export type UpdateAlertRuleInput = z.infer<typeof updateAlertRuleSchema>;
