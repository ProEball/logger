"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { TimeRange } from "@/features/events/utils/event-filters.types";
import { parseDashboardRange } from "@/features/dashboard/utils/dashboard-range";

export type UseDashboardRange = {
    /** The committed range — what the URL says, and what the page fetched. */
    range: TimeRange;
    /**
     * What the control should render as selected. Equal to `range` except while
     * a switch is in flight, when it is the range the user just asked for.
     */
    displayRange: TimeRange;
    /** True while a range switch is in flight. Drives the loading hint only. */
    isPending: boolean;
    setRange: (range: TimeRange) => void;
};

/** Two ranges are the same selection if they would produce the same URL. */
function rangeKey(range: TimeRange): string {
    return range.type === "preset" ? `p:${range.value}` : `c:${range.from}:${range.to}`;
}

/**
 * Manage the dashboard time range via URL search params.
 * Independent from events page — each page owns its own range state (Q-E3).
 *
 * **Why this hook reports a pending state (2026-08-22).** The range lives in the
 * URL, and the App Router does not commit a URL until the new payload is ready.
 * The chips read their selection from `useSearchParams()`, so until then the
 * clicked chip did not restyle, no `Suspense` fallback appeared — a transition
 * deliberately holds the current UI — and nothing at all moved. Measured on a
 * 30-day range with staggered delays: thirty DOM samples over twenty-eight
 * seconds, zero skeletons, `location.search` unchanged throughout. The complaint
 * that produced this was not "the page is slow" but "the button does nothing",
 * and that is exactly what it did.
 *
 * `displayRange` fixes the visible half: the clicked chip goes active on the
 * click, from optimistic state, and `isPending` drives a hint for the wait.
 *
 * The optimistic value is cleared by **comparing the committed range against the
 * previous one during render**, not by an effect and not by watching
 * `isPending`. `PROJECT.md` §5 requires that shape, and it is also the only one
 * that is honest here: a transition can settle without the URL having changed
 * (a rejected navigation, or a push to the range already selected), and clearing
 * on `isPending` would then strand the control showing a selection the page
 * never loaded.
 */
export function useDashboardRange(): UseDashboardRange {
    const searchParams = useSearchParams();
    const router = useRouter();
    const [isPending, startTransition] = useTransition();

    const range = parseDashboardRange(searchParams.get("range"));
    const committedKey = rangeKey(range);

    const [pendingRange, setPendingRange] = useState<TimeRange | null>(null);
    const [lastCommittedKey, setLastCommittedKey] = useState(committedKey);

    // Adjust during render: the moment the URL catches up, the optimistic value
    // has nothing left to say.
    if (committedKey !== lastCommittedKey) {
        setLastCommittedKey(committedKey);
        setPendingRange(null);
    }

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
            setPendingRange(newRange);
            startTransition(() => {
                router.push(`?${params.toString()}`);
            });
        },
        [searchParams, router],
    );

    return {
        range,
        displayRange: pendingRange ?? range,
        isPending,
        setRange,
    };
}
