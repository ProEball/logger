import { describe, it, expect, vi, beforeEach } from "vitest";
import { RollingWindowLimiter } from "./rate-limit.service";

describe("RollingWindowLimiter", () => {
    beforeEach(() => {
        vi.useRealTimers();
    });

    it("allows requests within the limit", () => {
        const limiter = new RollingWindowLimiter(10);
        for (let i = 0; i < 10; i++) {
            const result = limiter.take("key1");
            expect(result.allowed).toBe(true);
        }
    });

    it("blocks the request exceeding the limit", () => {
        const limiter = new RollingWindowLimiter(10);
        for (let i = 0; i < 10; i++) limiter.take("key1");
        const result = limiter.take("key1");
        expect(result.allowed).toBe(false);
        expect(result.retryAfterSeconds).toBeGreaterThan(0);
    });

    it("resets after the window elapses", () => {
        vi.useFakeTimers();
        const limiter = new RollingWindowLimiter(5);
        for (let i = 0; i < 5; i++) limiter.take("key1");
        expect(limiter.take("key1").allowed).toBe(false);

        vi.advanceTimersByTime(61_000);
        expect(limiter.take("key1").allowed).toBe(true);
    });

    it("tracks different keys independently", () => {
        const limiter = new RollingWindowLimiter(3);
        for (let i = 0; i < 3; i++) limiter.take("key1");
        expect(limiter.take("key1").allowed).toBe(false);
        expect(limiter.take("key2").allowed).toBe(true);
    });

    it("cleanup timer is started lazily on first take()", () => {
        const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
        const limiter = new RollingWindowLimiter(100);
        expect(setIntervalSpy).not.toHaveBeenCalled();
        limiter.take("key1");
        expect(setIntervalSpy).toHaveBeenCalledTimes(1);
        // Second call does not start another timer
        limiter.take("key1");
        expect(setIntervalSpy).toHaveBeenCalledTimes(1);
        setIntervalSpy.mockRestore();
        vi.useRealTimers();
    });

    it("batch count is respected", () => {
        const limiter = new RollingWindowLimiter(10);
        expect(limiter.take("key1", 10).allowed).toBe(true);
        expect(limiter.take("key1", 1).allowed).toBe(false);
    });
});
