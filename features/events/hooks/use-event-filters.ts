"use client";

import { useCallback } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { serializeFilters } from "@/features/events/utils/serialize-filters";
import { parseFilters } from "@/features/events/utils/parse-filters";
import type { EventFilters, TimeRange } from "@/features/events/utils/event-filters.types";

export function useEventFilters(): {
    filters: EventFilters;
    applyFilters: (next: Omit<EventFilters, "range">) => void;
    setTimeRange: (range: TimeRange) => void;
    removeAttribute: (key: string) => void;
    removeFilter: (key: keyof EventFilters) => void;
    clearAll: () => void;
} {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();

    const filters = parseFilters(new URLSearchParams(searchParams.toString()));

    /** Replace the URL, stripping cursor (before_ts, before_id) and event drawer params */
    const navigate = useCallback(
        (newFilters: EventFilters) => {
            const params = serializeFilters(newFilters);
            // Preserve event/tab drawer state
            const eventId = searchParams.get("event");
            const eventTs = searchParams.get("event_ts");
            const tab = searchParams.get("tab");
            if (eventId) params.set("event", eventId);
            if (eventTs) params.set("event_ts", eventTs);
            if (tab) params.set("tab", tab);
            // NOTE: before_ts / before_id are intentionally NOT preserved — cursor resets on filter change
            router.replace(`${pathname}?${params.toString()}`);
        },
        [router, pathname, searchParams],
    );

    /** Commit every non-range filter field at once — the Filters popover owns all of them as one draft. */
    const applyFilters = useCallback(
        (next: Omit<EventFilters, "range">) =>
            navigate({
                range: filters.range,
                levels: next.levels?.length ? next.levels : undefined,
                environments: next.environments?.length ? next.environments : undefined,
                sources: next.sources?.length ? next.sources : undefined,
                releases: next.releases?.length ? next.releases : undefined,
                errorTypes: next.errorTypes?.length ? next.errorTypes : undefined,
                userId: next.userId || undefined,
                sessionId: next.sessionId || undefined,
                requestId: next.requestId || undefined,
                traceId: next.traceId || undefined,
                message: next.message || undefined,
                attributes: next.attributes?.length ? next.attributes : undefined,
            }),
        [filters, navigate],
    );

    const setTimeRange = useCallback(
        (range: TimeRange) => navigate({ ...filters, range }),
        [filters, navigate],
    );

    const removeAttribute = useCallback(
        (key: string) => {
            const updated = (filters.attributes ?? []).filter((a) => a.key !== key);
            navigate({ ...filters, attributes: updated.length ? updated : undefined });
        },
        [filters, navigate],
    );

    const removeFilter = useCallback(
        (key: keyof EventFilters) => {
            const updated = { ...filters };
            if (key !== "range") {
                delete updated[key];
            }
            navigate(updated);
        },
        [filters, navigate],
    );

    const clearAll = useCallback(
        () => navigate({ range: filters.range }),
        [filters, navigate],
    );

    return {
        filters,
        applyFilters,
        setTimeRange,
        removeAttribute,
        removeFilter,
        clearAll,
    };
}
