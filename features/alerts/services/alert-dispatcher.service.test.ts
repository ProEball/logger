import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/core/db/client", () => ({ db: {} }));
vi.mock("@/core/db/schema", () => ({ alertNotifications: {} }));

import { deliverWebhook } from "./alert-dispatcher.service";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const TEST_URL = "https://webhook.example.com/hook";
const TEST_PAYLOAD = { rule_id: "abc", state: "firing", test: false };

function mockResponse(status: number, ok: boolean) {
    return Promise.resolve({ status, ok } as Response);
}

describe("deliverWebhook", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("returns ok:true on 2xx response", async () => {
        mockFetch.mockResolvedValue({ status: 200, ok: true });
        const result = await deliverWebhook(TEST_URL, TEST_PAYLOAD);
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.status).toBe(200);
    });

    it("returns ok:true on 201 response", async () => {
        mockFetch.mockResolvedValue({ status: 201, ok: true });
        const result = await deliverWebhook(TEST_URL, TEST_PAYLOAD);
        expect(result.ok).toBe(true);
    });

    it("returns ok:false with shouldRetry:false on 4xx response", async () => {
        mockFetch.mockResolvedValue({ status: 400, ok: false });
        const result = await deliverWebhook(TEST_URL, TEST_PAYLOAD);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.shouldRetry).toBe(false);
            expect(result.status).toBe(400);
        }
    });

    it("returns ok:false with shouldRetry:false on 404 response", async () => {
        mockFetch.mockResolvedValue({ status: 404, ok: false });
        const result = await deliverWebhook(TEST_URL, TEST_PAYLOAD);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.shouldRetry).toBe(false);
    });

    it("returns ok:false with shouldRetry:true on 500 response", async () => {
        mockFetch.mockResolvedValue({ status: 500, ok: false });
        const result = await deliverWebhook(TEST_URL, TEST_PAYLOAD);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.shouldRetry).toBe(true);
            expect(result.status).toBe(500);
        }
    });

    it("returns ok:false with shouldRetry:true on network error", async () => {
        mockFetch.mockRejectedValue(new Error("network failure"));
        const result = await deliverWebhook(TEST_URL, TEST_PAYLOAD);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.shouldRetry).toBe(true);
            expect(result.error).toContain("network failure");
        }
    });

    it("returns ok:false with shouldRetry:true on timeout", async () => {
        const abortErr = new Error("Aborted");
        abortErr.name = "AbortError";
        mockFetch.mockRejectedValue(abortErr);
        const result = await deliverWebhook(TEST_URL, TEST_PAYLOAD);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.shouldRetry).toBe(true);
            expect(result.error).toContain("timed out");
        }
    });

    it("sends custom headers", async () => {
        mockFetch.mockResolvedValue({ status: 200, ok: true });
        await deliverWebhook(TEST_URL, TEST_PAYLOAD, [{ key: "X-Secret", value: "token123" }]);
        const calledHeaders = mockFetch.mock.calls[0][1].headers;
        expect(calledHeaders["X-Secret"]).toBe("token123");
    });

    it("always sends Content-Type: application/json", async () => {
        mockFetch.mockResolvedValue({ status: 200, ok: true });
        await deliverWebhook(TEST_URL, TEST_PAYLOAD);
        const calledHeaders = mockFetch.mock.calls[0][1].headers;
        expect(calledHeaders["Content-Type"]).toBe("application/json");
    });
});
