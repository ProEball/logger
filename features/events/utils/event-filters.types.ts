import type { EventLevel } from "@/features/ingest/utils/event-schema";

export type TimeRangePreset = "15m" | "1h" | "6h" | "24h" | "7d" | "30d";

export type TimeRange =
    | { type: "preset"; value: TimeRangePreset }
    | { type: "custom"; from: string; to: string }; // ISO UTC strings

export type AttributeFilter = {
    key: string;
    value: string;
};

export type EventFilters = {
    range: TimeRange;
    levels?: EventLevel[];
    environments?: string[];
    sources?: string[];
    releases?: string[];
    errorTypes?: string[];
    userId?: string;
    sessionId?: string;
    requestId?: string;
    traceId?: string;
    message?: string;
    attributes?: AttributeFilter[];
};

export type Cursor = {
    beforeTs: string; // ISO UTC string
    beforeId: string;
};

export const DEFAULT_FILTERS: EventFilters = {
    range: { type: "preset", value: "1h" },
};
