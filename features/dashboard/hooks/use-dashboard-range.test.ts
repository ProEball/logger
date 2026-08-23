import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const { pushMock, searchParams } = vi.hoisted(() => ({
    pushMock: vi.fn(),
    searchParams: { current: new URLSearchParams() },
}));

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: pushMock }),
    useSearchParams: () => searchParams.current,
}));

import { useDashboardRange } from "./use-dashboard-range";

beforeEach(() => {
    pushMock.mockReset();
    searchParams.current = new URLSearchParams();
});

/**
 * The dashboard keeps its range in the URL rather than in component state, so
 * a link to a dashboard carries what it was showing. That makes the search
 * params the boundary worth testing: what the hook reads out of them, and what
 * it writes back.
 */
describe("useDashboardRange", () => {
    it("reads the preset from the URL", () => {
        searchParams.current = new URLSearchParams("range=7d");

        const { result } = renderHook(() => useDashboardRange());

        expect(result.current.range).toEqual({ type: "preset", value: "7d" });
    });

    it("falls back to the default when the param is absent", () => {
        const { result } = renderHook(() => useDashboardRange());

        expect(result.current.range).toEqual({ type: "preset", value: "1h" });
    });

    it("falls back to the default for an unrecognised preset", () => {
        searchParams.current = new URLSearchParams("range=42h");

        const { result } = renderHook(() => useDashboardRange());

        expect(result.current.range).toEqual({ type: "preset", value: "1h" });
    });

    it("writes a chosen preset back to the URL", () => {
        const { result } = renderHook(() => useDashboardRange());

        act(() => result.current.setRange({ type: "preset", value: "24h" }));

        expect(pushMock).toHaveBeenCalledTimes(1);
        expect(String(pushMock.mock.calls[0][0])).toContain("range=24h");
    });

    /**
     * Other params on the dashboard URL must survive a range change — losing
     * them would turn a range click into a silent reset of everything else the
     * URL was carrying.
     */
    it("preserves other search params when changing the range", () => {
        searchParams.current = new URLSearchParams("range=1h&view=table");

        const { result } = renderHook(() => useDashboardRange());
        act(() => result.current.setRange({ type: "preset", value: "7d" }));

        const pushed = String(pushMock.mock.calls[0][0]);
        expect(pushed).toContain("range=7d");
        expect(pushed).toContain("view=table");
    });

    it("uses the same parser as the route", () => {
        // Not a second implementation: both go through `parseDashboardRange`.
        // Until 2026-08-21 they were two functions over two preset lists that
        // agreed by coincidence.
        searchParams.current = new URLSearchParams("range=");

        const { result } = renderHook(() => useDashboardRange());

        expect(result.current.range).toEqual({ type: "preset", value: "1h" });
    });
    /**
     * The optimistic half. The App Router does not commit a URL until the new
     * payload is ready, so on a 30-day range the chips read the *old* range
     * from `useSearchParams()` for seventeen seconds. Measured 2026-08-22:
     * thirty DOM samples over twenty-eight seconds after a chip click, zero
     * skeletons, `location.search` unchanged throughout — the control looked
     * broken rather than busy.
     *
     * Verified by breaking the hook, not by watching it go green: removing the
     * optimistic value fails exactly "shows the clicked range immediately", and
     * removing the clear-on-commit fails exactly "returns to the committed range
     * if the URL settles somewhere else". Two tests written alongside these were
     * deleted for failing that check — they could not fail under either defect,
     * which in this repository is the shape a test has when it is measuring
     * nothing.
     */
    describe("pending range", () => {
        it("shows the clicked range immediately, before the URL commits", () => {
            searchParams.current = new URLSearchParams("range=1h");
            const { result } = renderHook(() => useDashboardRange());

            act(() => result.current.setRange({ type: "preset", value: "30d" }));

            expect(result.current.displayRange).toEqual({ type: "preset", value: "30d" });
        });

        it("leaves the committed range alone — the page still shows what it fetched", () => {
            searchParams.current = new URLSearchParams("range=1h");
            const { result } = renderHook(() => useDashboardRange());

            act(() => result.current.setRange({ type: "preset", value: "30d" }));

            // `range` is what the URL says and what the data is for. Only the
            // control's highlight runs ahead.
            expect(result.current.range).toEqual({ type: "preset", value: "1h" });
        });

        /**
         * The case that would strand the control: a navigation that never
         * arrives at what was clicked. Clearing on `isPending` instead of on a
         * change of committed range would leave "30d" highlighted on a page
         * showing 1h data, indefinitely.
         */
        it("returns to the committed range if the URL settles somewhere else", () => {
            searchParams.current = new URLSearchParams("range=1h");
            const { result, rerender } = renderHook(() => useDashboardRange());

            act(() => result.current.setRange({ type: "preset", value: "30d" }));
            searchParams.current = new URLSearchParams("range=7d");
            rerender();

            expect(result.current.displayRange).toEqual({ type: "preset", value: "7d" });
        });

        it("keeps showing the committed range when nothing has been clicked", () => {
            searchParams.current = new URLSearchParams("range=6h");
            const { result } = renderHook(() => useDashboardRange());

            expect(result.current.displayRange).toEqual(result.current.range);
        });

        it("is not pending before anything is clicked", () => {
            const { result } = renderHook(() => useDashboardRange());
            expect(result.current.isPending).toBe(false);
        });
    });
});
