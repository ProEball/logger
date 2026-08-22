"use client";

import { useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { TimeRange } from "@/features/events/utils/event-filters.types";
import { parseDashboardRange } from "@/features/dashboard/utils/dashboard-range";


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

    const range = parseDashboardRange(searchParams.get("range"));

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
