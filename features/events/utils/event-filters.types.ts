export type {
    TimeRangePreset,
    TimeRange,
    AttributeFilter,
    EventFilters,
} from "@/shared/utils/event-filters.schema";

export const DEFAULT_FILTERS = {
    range: { type: "preset" as const, value: "1h" as const },
} satisfies import("@/shared/utils/event-filters.schema").EventFilters;

export type Cursor = {
    beforeTs: string;
    beforeId: string;
};

export type FacetOption = {
    value: string;
    count: number;
};

export type FacetCounts = {
    levels: FacetOption[];
    environments: FacetOption[];
    sources: FacetOption[];
    releases: FacetOption[];
    errorTypes: FacetOption[];
};
