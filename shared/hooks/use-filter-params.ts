"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/**
 * URL-backed filter state with an optimistic selection and a pending flag.
 *
 * **Why this exists (2026-08-25).** Both dashboards keep their filters in the
 * URL, and the App Router does not commit a URL until the new payload is ready.
 * A control that reads its selection from `useSearchParams()` therefore does
 * *nothing* on click: the clicked chip does not restyle, no `Suspense` fallback
 * appears — a transition deliberately holds the current UI — and the page sits
 * unchanged until the server answers.
 *
 * That was diagnosed and fixed for the project dashboard on 2026-08-22, in
 * `use-dashboard-range.ts`, from a complaint that was not "the page is slow" but
 * **"the button does nothing"**. The fix was never carried to the organization
 * overview, whose filter bar still called `router.push()` bare — so the same
 * defect was live there until this hook replaced it. Measuring the overview's
 * SQL on 2026-08-25 is what turned it up: the queries came back in 19–25 ms on a
 * 500k-event corpus, which cannot account for a wait anybody would notice, and
 * the wait people noticed was the absence of feedback rather than the presence
 * of work.
 *
 * So the mechanism lives in one place now, `shared/` rather than either feature,
 * and `useDashboardRange` is a typed wrapper over it. Two copies of an
 * optimistic-state machine is exactly the arrangement that let one of them go
 * unfixed for three days without anyone noticing the other had been.
 *
 * ## Conventions
 *
 * A parameter's value is a plain string, and **the empty string means absent**.
 * That matches what the filter bars already do — the overview treats
 * `environment === ""` as "all environments" — and it keeps the caller from
 * having to distinguish "" from `undefined` in JSX where both render as nothing.
 * Writing `""` deletes the parameter rather than emitting `?env=`.
 *
 * Parameters not named in `keys` are **preserved** across a write. Losing them
 * would turn one filter click into a silent reset of every other filter the URL
 * was carrying.
 */
export interface UseFilterParams<K extends string> {
    /** What the URL says — and therefore what the page actually fetched. */
    values: Record<K, string>;
    /**
     * What the controls should render as selected. Equal to {@link values}
     * except while a write is in flight, when the keys just written show the
     * requested value instead.
     *
     * Per key, not wholesale: clicking an environment must not make the range
     * chips flicker back to a value nobody chose.
     */
    displayValues: Record<K, string>;
    /** True while a navigation is in flight. Drives a busy hint, nothing else. */
    isPending: boolean;
    setParam: (key: K, value: string) => void;
    /** Several at once, as one navigation. */
    setParams: (patch: Partial<Record<K, string>>) => void;
}

export function useFilterParams<K extends string>(keys: readonly K[]): UseFilterParams<K> {
    const searchParams = useSearchParams();
    const router = useRouter();
    const [isPending, startTransition] = useTransition();

    // Stable across renders even though `keys` is usually an inline array, so
    // the memo below is not defeated by its own argument.
    const keyList = keys.join(",");

    const values = useMemo(() => {
        const out = {} as Record<K, string>;
        for (const key of keyList.split(",").filter(Boolean) as K[]) {
            out[key] = searchParams.get(key) ?? "";
        }
        return out;
    }, [keyList, searchParams]);

    /** The committed selection as one comparable string. */
    const committedKey = keyList
        .split(",")
        .filter(Boolean)
        .map((key) => `${key}=${values[key as K]}`)
        .join("&");

    const [pending, setPending] = useState<Partial<Record<K, string>> | null>(null);
    const [lastCommittedKey, setLastCommittedKey] = useState(committedKey);

    // Adjusted during render rather than in an effect — PROJECT.md §5, and the
    // only honest shape besides: a transition can settle without the URL having
    // changed (a rejected navigation, or a push to what was already selected),
    // and clearing on `isPending` would strand the control showing a selection
    // the page never loaded.
    if (committedKey !== lastCommittedKey) {
        setLastCommittedKey(committedKey);
        setPending(null);
    }

    const setParams = useCallback(
        (patch: Partial<Record<K, string>>) => {
            const next = new URLSearchParams(searchParams.toString());
            for (const [key, value] of Object.entries(patch) as [K, string | undefined][]) {
                if (value) next.set(key, value);
                else next.delete(key);
            }
            setPending(patch);
            startTransition(() => {
                router.push(`?${next.toString()}`);
            });
        },
        [router, searchParams],
    );

    const setParam = useCallback(
        (key: K, value: string) => setParams({ [key]: value } as Partial<Record<K, string>>),
        [setParams],
    );

    const displayValues = useMemo(() => {
        if (!pending) return values;
        const out = { ...values };
        for (const [key, value] of Object.entries(pending) as [K, string | undefined][]) {
            if (key in out) out[key] = value ?? "";
        }
        return out;
    }, [pending, values]);

    return { values, displayValues, isPending, setParam, setParams };
}
