import { describe, it, expect } from "vitest";
import { checkWebhookUrl, isPrivateHost } from "./webhook-url";

describe("isPrivateHost", () => {
    it.each([
        ["127.0.0.1", "loopback"],
        ["10.1.2.3", "RFC1918 /8"],
        ["172.16.0.1", "RFC1918 /12 lower bound"],
        ["172.31.255.255", "RFC1918 /12 upper bound"],
        ["192.168.1.1", "RFC1918 /16"],
        ["169.254.169.254", "cloud metadata"],
        ["100.64.0.1", "CGNAT"],
        ["0.0.0.0", "this network"],
        ["224.0.0.1", "multicast"],
        ["::1", "IPv6 loopback"],
        ["fc00::1", "IPv6 unique-local"],
        ["fe80::1", "IPv6 link-local"],
        ["::ffff:10.0.0.1", "IPv4-mapped private"],
        ["localhost", "bare hostname"],
        ["api.localhost", ".localhost suffix"],
    ])("rejects %s (%s)", (host) => {
        expect(isPrivateHost(host)).toBe(true);
    });

    it.each([
        ["8.8.8.8"],
        ["1.1.1.1"],
        ["172.15.0.1"], // just below the RFC1918 /12 block
        ["172.32.0.1"], // just above it
        ["192.167.0.1"], // just below 192.168/16
        ["hooks.slack.com"],
        ["2606:4700::1111"],
    ])("accepts %s", (host) => {
        expect(isPrivateHost(host)).toBe(false);
    });
});

describe("checkWebhookUrl", () => {
    it("accepts a plain https URL", () => {
        expect(checkWebhookUrl("https://hooks.example.com/abc")).toEqual({ ok: true });
    });

    it("rejects a malformed URL", () => {
        expect(checkWebhookUrl("not a url")).toMatchObject({ ok: false });
    });

    it("rejects non-http schemes", () => {
        expect(checkWebhookUrl("file:///etc/passwd")).toMatchObject({
            ok: false,
            reason: expect.stringContaining("http or https"),
        });
    });

    it("rejects embedded credentials", () => {
        expect(checkWebhookUrl("https://user:pass@example.com/hook")).toMatchObject({
            ok: false,
            reason: expect.stringContaining("credentials"),
        });
    });

    it("rejects the cloud metadata endpoint", () => {
        expect(checkWebhookUrl("http://169.254.169.254/latest/meta-data/")).toMatchObject({
            ok: false,
            reason: expect.stringContaining("private or loopback"),
        });
    });

    it("rejects loopback regardless of port", () => {
        expect(checkWebhookUrl("http://127.0.0.1:8080/hook")).toMatchObject({ ok: false });
    });
});
