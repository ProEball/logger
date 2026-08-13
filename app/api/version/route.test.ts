import { describe, it, expect, afterEach, vi } from "vitest";
import { GET } from "./route";

// `next build` inlines NEXT_PUBLIC_* at build time; under vitest they are read
// from process.env at call time, which is what lets the fallbacks be exercised.
const original = {
    sha: process.env.NEXT_PUBLIC_BUILD_SHA,
    time: process.env.NEXT_PUBLIC_BUILD_TIME,
};

afterEach(() => {
    vi.unstubAllEnvs();
    process.env.NEXT_PUBLIC_BUILD_SHA = original.sha;
    process.env.NEXT_PUBLIC_BUILD_TIME = original.time;
});

describe("GET /api/version", () => {
    it("reports the build metadata when it was passed at build time", async () => {
        vi.stubEnv("NEXT_PUBLIC_BUILD_SHA", "c4eb4f4");
        vi.stubEnv("NEXT_PUBLIC_BUILD_TIME", "2026-08-13T10:00:00Z");

        await expect(GET().json()).resolves.toMatchObject({
            sha: "c4eb4f4",
            builtAt: "2026-08-13T10:00:00Z",
        });
    });

    it("falls back to dev for an empty build sha, not just an unset one", async () => {
        // Regression: the Dockerfile declares `ARG NEXT_PUBLIC_BUILD_SHA=""`, so
        // a build without --build-arg inlines "" rather than leaving it
        // undefined. `??` passed the empty string straight through.
        vi.stubEnv("NEXT_PUBLIC_BUILD_SHA", "");
        vi.stubEnv("NEXT_PUBLIC_BUILD_TIME", "");

        await expect(GET().json()).resolves.toMatchObject({
            sha: "dev",
            builtAt: null,
        });
    });

    it("falls back to dev when the variables are unset entirely", async () => {
        delete process.env.NEXT_PUBLIC_BUILD_SHA;
        delete process.env.NEXT_PUBLIC_BUILD_TIME;

        await expect(GET().json()).resolves.toMatchObject({
            sha: "dev",
            builtAt: null,
        });
    });

    it("always reports the runtime versions", async () => {
        const body = (await GET().json()) as { nodeVersion: string; nextVersion: string };

        expect(body.nodeVersion).toBe(process.version);
        expect(body.nextVersion).toMatch(/^\d+\.\d+\.\d+/);
    });
});
