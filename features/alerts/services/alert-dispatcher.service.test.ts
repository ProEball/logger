import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/core/db/client", () => ({ db: {} }));
vi.mock("@/core/db/schema", () => ({ alertNotifications: {} }));

// DNS is the one real external boundary the SSRF guard touches; stub it so the
// suite neither hits the network nor depends on how example.com resolves.
const mockLookup = vi.hoisted(() => vi.fn());
vi.mock("node:dns/promises", () => ({ lookup: mockLookup, default: { lookup: mockLookup } }));

import { deliverWebhook } from "./alert-dispatcher.service";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const TEST_URL = "https://webhook.example.com/hook";
const TEST_PAYLOAD = { rule_id: "abc", state: "firing", test: false };

describe("deliverWebhook", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
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

    describe("SSRF guard", () => {
        it("refuses a loopback literal without dispatching", async () => {
            const result = await deliverWebhook("http://127.0.0.1/hook", TEST_PAYLOAD);
            expect(mockFetch).not.toHaveBeenCalled();
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.shouldRetry).toBe(false);
        });

        it("refuses a host that resolves to a private address", async () => {
            mockLookup.mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);
            const result = await deliverWebhook(TEST_URL, TEST_PAYLOAD);
            expect(mockFetch).not.toHaveBeenCalled();
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.error).toContain("private address");
        });

        it("refuses when any resolved address is private, not just the first", async () => {
            mockLookup.mockResolvedValue([
                { address: "93.184.216.34", family: 4 },
                { address: "10.0.0.5", family: 4 },
            ]);
            const result = await deliverWebhook(TEST_URL, TEST_PAYLOAD);
            expect(mockFetch).not.toHaveBeenCalled();
            expect(result.ok).toBe(false);
        });

        it("does not follow redirects", async () => {
            mockFetch.mockResolvedValue({ status: 302, ok: false });
            const result = await deliverWebhook(TEST_URL, TEST_PAYLOAD);
            expect(mockFetch.mock.calls[0][1].redirect).toBe("manual");
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.shouldRetry).toBe(false);
                expect(result.error).toContain("redirected");
            }
        });
    });
});
