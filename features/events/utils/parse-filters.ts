import { z } from "zod";
import { VALID_LEVELS } from "@/features/ingest/utils/event-schema";
import type { EventFilters, TimeRange, TimeRangePreset, AttributeFilter } from "./event-filters.types";
import { DEFAULT_FILTERS } from "./event-filters.types";

const VALID_PRESETS: TimeRangePreset[] = ["15m", "1h", "6h", "24h", "7d", "30d"];

const isoUtcSchema = z.string().datetime({ offset: true });

/**
 * Parse URLSearchParams into EventFilters.
 * Invalid keys are stripped; valid ones are kept. Never throws (Q-D filter parse rule).
 */
export function parseFilters(params: URLSearchParams): EventFilters {
    const filters: EventFilters = { range: parseTimeRange(params) };

    const rawLevels = params.get("levels");
    if (rawLevels) {
        const candidates = rawLevels.split(",").map((s) => s.trim());
        const valid = candidates.filter((l): l is typeof VALID_LEVELS[number] =>
            (VALID_LEVELS as readonly string[]).includes(l),
        );
        if (valid.length > 0) filters.levels = valid;
    }

    const multiStr = (key: string): string[] | undefined => {
        const raw = params.get(key);
        if (!raw) return undefined;
        const items = raw.split(",").map((s) => s.trim()).filter(Boolean);
        return items.length > 0 ? items : undefined;
    };

    const envs = multiStr("environments");
    if (envs) filters.environments = envs;

    const sources = multiStr("sources");
    if (sources) filters.sources = sources;

    const releases = multiStr("releases");
    if (releases) filters.releases = releases;

    const errorTypes = multiStr("errorTypes");
    if (errorTypes) filters.errorTypes = errorTypes;

    const singleStr = (key: string): string | undefined => {
        const v = params.get(key);
        return v?.trim() || undefined;
    };

    const userId = singleStr("userId");
    if (userId) filters.userId = userId;

    const sessionId = singleStr("sessionId");
    if (sessionId) filters.sessionId = sessionId;

    const requestId = singleStr("requestId");
    if (requestId) filters.requestId = requestId;

    const traceId = singleStr("traceId");
    if (traceId) filters.traceId = traceId;

    const message = singleStr("message");
    if (message) filters.message = message;

    const attrs: AttributeFilter[] = [];
    for (const [key, value] of params.entries()) {
        if (key.startsWith("attribute.")) {
            const attrKey = key.slice("attribute.".length);
            if (attrKey) attrs.push({ key: attrKey, value });
        }
    }
    if (attrs.length > 0) filters.attributes = attrs;

    return filters;
}

function parseTimeRange(params: URLSearchParams): TimeRange {
    const rangeParam = params.get("range");
    const fromParam = params.get("range_from");
    const toParam = params.get("range_to");

    if (fromParam && toParam) {
        const fromResult = isoUtcSchema.safeParse(fromParam);
        const toResult = isoUtcSchema.safeParse(toParam);
        if (fromResult.success && toResult.success) {
            return { type: "custom", from: fromParam, to: toParam };
        }
        // Invalid custom range — fall through to preset
    }

    if (rangeParam && (VALID_PRESETS as string[]).includes(rangeParam)) {
        return { type: "preset", value: rangeParam as TimeRangePreset };
    }

    return DEFAULT_FILTERS.range;
}
