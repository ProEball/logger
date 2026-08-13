import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startHealthTouch, DEFAULT_TOUCH_INTERVAL_MS } from "./health-touch";

// The filesystem is a real system boundary, so it is exercised for real against
// a throwaway directory rather than stubbed. The clock is the only thing faked.
let workDir: string;

beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "health-touch-"));
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
});

afterEach(() => {
    vi.useRealTimers();
    rmSync(workDir, { recursive: true, force: true });
});

describe("startHealthTouch", () => {
    it("creates the file immediately, before the first interval elapses", () => {
        const filePath = join(workDir, "worker-alive");

        const health = startHealthTouch(filePath);

        expect(existsSync(filePath)).toBe(true);
        health.stop();
    });

    it("advances the mtime on every interval", () => {
        const filePath = join(workDir, "worker-alive");
        const health = startHealthTouch(filePath);
        const initialMtime = statSync(filePath).mtimeMs;

        vi.advanceTimersByTime(DEFAULT_TOUCH_INTERVAL_MS);

        expect(statSync(filePath).mtimeMs).toBeGreaterThan(initialMtime);
        health.stop();
    });

    it("stops advancing the mtime once stopped — this is what marks the container unhealthy", () => {
        const filePath = join(workDir, "worker-alive");
        const health = startHealthTouch(filePath);

        health.stop();
        const mtimeAtStop = statSync(filePath).mtimeMs;
        vi.advanceTimersByTime(DEFAULT_TOUCH_INTERVAL_MS * 5);

        expect(statSync(filePath).mtimeMs).toBe(mtimeAtStop);
    });

    it("tolerates being stopped twice", () => {
        const health = startHealthTouch(join(workDir, "worker-alive"));

        health.stop();

        expect(() => health.stop()).not.toThrow();
    });

    it("preserves an existing file rather than truncating it", () => {
        const filePath = join(workDir, "worker-alive");
        writeFileSync(filePath, "previous run");

        const health = startHealthTouch(filePath);

        expect(statSync(filePath).size).toBe("previous run".length);
        health.stop();
    });

    it("logs and swallows an unwritable path instead of taking the worker down", () => {
        const unwritable = join(workDir, "does", "not", "exist", "worker-alive");

        // A worker draining jobs correctly must not die because /tmp filled up;
        // the stale mtime alone is enough to fail the healthcheck.
        expect(() => startHealthTouch(unwritable).stop()).not.toThrow();
        expect(existsSync(unwritable)).toBe(false);
    });

    it("keeps retrying after a failed touch", () => {
        const filePath = join(workDir, "worker-alive");
        const health = startHealthTouch(filePath);
        rmSync(filePath);

        vi.advanceTimersByTime(DEFAULT_TOUCH_INTERVAL_MS);

        // The interval recreates the file rather than staying broken forever.
        expect(existsSync(filePath)).toBe(true);
        health.stop();
    });
});
