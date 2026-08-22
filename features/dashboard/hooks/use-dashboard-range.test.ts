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
});
