"use client";

import { useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { TimeRange, TimeRangePreset } from "@/features/events/utils/event-filters.types";

export const DASHBOARD_PRESETS: TimeRangePreset[] = ["15m", "1h", "6h", "24h", "7d", "30d"];

const VALID_PRESETS = new Set<string>(DASHBOARD_PRESETS);

const DEFAULT_RANGE: TimeRange = { type: "preset", value: "1h" };

function parseRange(params: URLSearchParams): TimeRange {
    const r = params.get("range");
    if (r && VALID_PRESETS.has(r)) {
        return { type: "preset", value: r as TimeRangePreset };
    }
    return DEFAULT_RANGE;
}

export type UseDashboardRange = {
    range: TimeRange;
    setRange: (range: TimeRange) => void;
};

/**
 * Manage the dashboard time range via URL search params.
 * Independent from events page — each page owns its own range state (Q-E3).
 */
export function useDashboardRange(): UseDashboardRange {
    const searchParams = useSearchParams();
    const router = useRouter();

    const range = parseRange(searchParams);

    const setRange = useCallback(
        (newRange: TimeRange) => {
            const params = new URLSearchParams(searchParams.toString());
            if (newRange.type === "custom") {
                params.delete("range");
                params.set("range_from", newRange.from);
                params.set("range_to", newRange.to);
            } else {
                params.delete("range_from");
                params.delete("range_to");
                params.set("range", newRange.value);
            }
            router.push(`?${params.toString()}`);
        },
        [searchParams, router],
    );

    return { range, setRange };
}
