import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";

const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

import { useAutoRefresh } from "@/features/events/hooks/use-auto-refresh";

beforeEach(() => {
    vi.useFakeTimers();
    refreshMock.mockClear();
});

afterEach(() => {
    vi.useRealTimers();
});

describe("useAutoRefresh", () => {
    it("never refreshes when auto-refresh is off", () => {
        renderHook(() => useAutoRefresh("off"));
        vi.advanceTimersByTime(10 * 60_000);
        expect(refreshMock).not.toHaveBeenCalled();
    });

    it("refreshes on the 30s interval", () => {
        renderHook(() => useAutoRefresh("30s"));

        vi.advanceTimersByTime(29_000);
        expect(refreshMock).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1_000);
        expect(refreshMock).toHaveBeenCalledTimes(1);
    });

    it("keeps refreshing rather than firing once", () => {
        renderHook(() => useAutoRefresh("60s"));
        vi.advanceTimersByTime(3 * 60_000);
        expect(refreshMock).toHaveBeenCalledTimes(3);
    });

    it("supports the 5m interval added for a dashboard left open", () => {
        renderHook(() => useAutoRefresh("5m"));

        vi.advanceTimersByTime(4 * 60_000);
        expect(refreshMock).not.toHaveBeenCalled();

        vi.advanceTimersByTime(60_000);
        expect(refreshMock).toHaveBeenCalledTimes(1);
    });

    it("stops refreshing once unmounted", () => {
        // A leaked interval keeps hitting the server from a page nobody is on.
        const { unmount } = renderHook(() => useAutoRefresh("30s"));
        unmount();
        vi.advanceTimersByTime(5 * 60_000);
        expect(refreshMock).not.toHaveBeenCalled();
    });

    it("switches cadence when the preference changes, without doubling up", () => {
        const { rerender } = renderHook(({ value }) => useAutoRefresh(value), {
            initialProps: { value: "30s" as const },
        });

        vi.advanceTimersByTime(30_000);
        expect(refreshMock).toHaveBeenCalledTimes(1);

        rerender({ value: "60s" as unknown as "30s" });
        refreshMock.mockClear();

        // If the old interval survived the change there would be two refreshes
        // in this minute, not one.
        vi.advanceTimersByTime(60_000);
        expect(refreshMock).toHaveBeenCalledTimes(1);
    });

    it("stops when switched to off", () => {
        const { rerender } = renderHook(({ value }) => useAutoRefresh(value), {
            initialProps: { value: "30s" as const },
        });
        rerender({ value: "off" as unknown as "30s" });

        vi.advanceTimersByTime(5 * 60_000);
        expect(refreshMock).not.toHaveBeenCalled();
    });
});
