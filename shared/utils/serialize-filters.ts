import type { EventFilters } from "./event-filters.schema";

export function serializeFilters(filters: EventFilters): URLSearchParams {
    const params = new URLSearchParams();

    if (filters.range.type === "custom") {
        params.set("range_from", filters.range.from);
        params.set("range_to", filters.range.to);
    } else {
        params.set("range", filters.range.value);
    }

    if (filters.levels?.length) params.set("levels", filters.levels.join(","));
    if (filters.environments?.length) params.set("environments", filters.environments.join(","));
    if (filters.sources?.length) params.set("sources", filters.sources.join(","));
    if (filters.releases?.length) params.set("releases", filters.releases.join(","));
    if (filters.errorTypes?.length) params.set("errorTypes", filters.errorTypes.join(","));
    if (filters.userId) params.set("userId", filters.userId);
    if (filters.sessionId) params.set("sessionId", filters.sessionId);
    if (filters.requestId) params.set("requestId", filters.requestId);
    if (filters.traceId) params.set("traceId", filters.traceId);
    if (filters.message) params.set("message", filters.message);

    if (filters.attributes?.length) {
        for (const { key, value } of filters.attributes) {
            params.set(`attribute.${key}`, value);
        }
    }

    return params;
}
