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

import { useFilterParams } from "./use-filter-params";

beforeEach(() => {
    pushMock.mockReset();
    searchParams.current = new URLSearchParams();
});

const KEYS = ["range", "env"] as const;

/**
 * The search params are the boundary worth testing: what the hook reads out of
 * them, what it writes back, and what it shows in between — which is the half
 * that exists at all only because the App Router will not commit a URL until
 * the server has answered.
 *
 * Every test below was checked by breaking the hook rather than by watching it
 * go green. The optimistic tests fail with the `pending` state removed; the
 * clear-on-commit test fails with the render-time comparison removed; the
 * preservation test fails if the write starts from an empty `URLSearchParams`.
 */
describe("useFilterParams", () => {
    describe("reading", () => {
        it("reads each named param from the URL", () => {
            searchParams.current = new URLSearchParams("range=7d&env=production");

            const { result } = renderHook(() => useFilterParams(KEYS));

            expect(result.current.values).toEqual({ range: "7d", env: "production" });
        });

        it("reports an absent param as the empty string, not undefined", () => {
            searchParams.current = new URLSearchParams("range=7d");

            const { result } = renderHook(() => useFilterParams(KEYS));

            // "" is the documented "absent" value — a control rendering it gets
            // nothing rather than the string "undefined".
            expect(result.current.values.env).toBe("");
        });

        it("ignores params it was not asked about", () => {
            searchParams.current = new URLSearchParams("range=7d&view=table");

            const { result } = renderHook(() => useFilterParams(KEYS));

            expect(Object.keys(result.current.values).sort()).toEqual(["env", "range"]);
        });
    });

    describe("writing", () => {
        it("writes a chosen value back to the URL", () => {
            const { result } = renderHook(() => useFilterParams(KEYS));

            act(() => result.current.setParam("range", "24h"));

            expect(pushMock).toHaveBeenCalledTimes(1);
            expect(String(pushMock.mock.calls[0][0])).toContain("range=24h");
        });

        it("deletes the param when set to the empty string", () => {
            searchParams.current = new URLSearchParams("range=7d&env=production");
            const { result } = renderHook(() => useFilterParams(KEYS));

            act(() => result.current.setParam("env", ""));

            const pushed = String(pushMock.mock.calls[0][0]);
            expect(pushed).not.toContain("env=");
            expect(pushed).toContain("range=7d");
        });

        /**
         * Losing unrelated params would turn one filter click into a silent
         * reset of everything else the URL was carrying — including params this
         * hook was never told about.
         */
        it("preserves params it does not manage", () => {
            searchParams.current = new URLSearchParams("range=1h&view=table&refresh=60");
            const { result } = renderHook(() => useFilterParams(KEYS));

            act(() => result.current.setParam("range", "7d"));

            const pushed = String(pushMock.mock.calls[0][0]);
            expect(pushed).toContain("view=table");
            expect(pushed).toContain("refresh=60");
        });

        it("writes several params as one navigation", () => {
            const { result } = renderHook(() => useFilterParams(KEYS));

            act(() => result.current.setParams({ range: "24h", env: "staging" }));

            // One push, not two: two would put an intermediate state in history
            // and fetch a page nobody asked for.
            expect(pushMock).toHaveBeenCalledTimes(1);
            const pushed = String(pushMock.mock.calls[0][0]);
            expect(pushed).toContain("range=24h");
            expect(pushed).toContain("env=staging");
        });
    });

    /**
     * The optimistic half — the whole reason this hook is not two lines of
     * `router.push`. Without it a click produces no visible change at all until
     * the server answers, which reads as a broken control rather than a busy
     * one.
     */
    describe("pending selection", () => {
        it("shows the clicked value immediately, before the URL commits", () => {
            searchParams.current = new URLSearchParams("range=1h");
            const { result } = renderHook(() => useFilterParams(KEYS));

            act(() => result.current.setParam("range", "30d"));

            expect(result.current.displayValues.range).toBe("30d");
        });

        it("leaves the committed value alone — the page still shows what it fetched", () => {
            searchParams.current = new URLSearchParams("range=1h");
            const { result } = renderHook(() => useFilterParams(KEYS));

            act(() => result.current.setParam("range", "30d"));

            expect(result.current.values.range).toBe("1h");
        });

        /**
         * Per-key, not wholesale. Clicking an environment must not make the
         * range chips flicker: they were never part of the write.
         */
        it("does not disturb the display of a key that was not written", () => {
            searchParams.current = new URLSearchParams("range=6h&env=production");
            const { result } = renderHook(() => useFilterParams(KEYS));

            act(() => result.current.setParam("env", "staging"));

            expect(result.current.displayValues.range).toBe("6h");
            expect(result.current.displayValues.env).toBe("staging");
        });

        /**
         * The case that would strand a control: a navigation that never arrives
         * at what was clicked. Clearing on `isPending` instead of on a change of
         * committed value would leave "30d" highlighted on a page showing 7d
         * data, indefinitely.
         */
        it("returns to the committed value if the URL settles somewhere else", () => {
            searchParams.current = new URLSearchParams("range=1h");
            const { result, rerender } = renderHook(() => useFilterParams(KEYS));

            act(() => result.current.setParam("range", "30d"));
            searchParams.current = new URLSearchParams("range=7d");
            rerender();

            expect(result.current.displayValues.range).toBe("7d");
        });

        it("keeps showing the committed values when nothing has been clicked", () => {
            searchParams.current = new URLSearchParams("range=6h&env=production");
            const { result } = renderHook(() => useFilterParams(KEYS));

            expect(result.current.displayValues).toEqual(result.current.values);
        });

        it("is not pending before anything is clicked", () => {
            const { result } = renderHook(() => useFilterParams(KEYS));

            expect(result.current.isPending).toBe(false);
        });
    });
});
