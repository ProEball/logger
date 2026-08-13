// Isomorphic (no node: imports) — this module is reachable from the alert
// editor's client bundle via `webhookChannelSchema`. The DNS-resolving half of
// the SSRF guard lives in `services/webhook-target-guard.service.ts`.

/** Parsed IPv4 octets, or null when `host` is not a dotted-quad literal. */
function parseIpv4(host: string): number[] | null {
    const parts = host.split(".");
    if (parts.length !== 4) return null;

    const octets = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : -1));
    return octets.every((o) => o >= 0 && o <= 255) ? octets : null;
}

function isPrivateIpv4(octets: number[]): boolean {
    const [a, b] = octets as [number, number, number, number];

    return (
        a === 0 || // "this network"
        a === 10 || // RFC1918
        a === 127 || // loopback
        (a === 100 && b >= 64 && b <= 127) || // CGNAT
        (a === 169 && b === 254) || // link-local — includes cloud metadata
        (a === 172 && b >= 16 && b <= 31) || // RFC1918
        (a === 192 && b === 0) || // IETF protocol assignments
        (a === 192 && b === 168) || // RFC1918
        (a === 198 && (b === 18 || b === 19)) || // benchmarking
        a >= 224 // multicast + reserved
    );
}

function isPrivateIpv6(host: string): boolean {
    const h = host.toLowerCase().replace(/^\[|\]$/g, "");

    // IPv4-mapped (::ffff:10.0.0.1) — judge it by the embedded v4 address.
    const mapped = h.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) {
        const octets = parseIpv4(mapped[1]!);
        return octets ? isPrivateIpv4(octets) : true;
    }

    return (
        h === "::" || // unspecified
        h === "::1" || // loopback
        /^f[cd][0-9a-f]{2}:/.test(h) || // fc00::/7 unique-local
        /^fe[89ab][0-9a-f]:/.test(h) // fe80::/10 link-local
    );
}

/** True when `host` is an IP literal that points somewhere non-public. */
export function isPrivateHost(host: string): boolean {
    const octets = parseIpv4(host);
    if (octets) return isPrivateIpv4(octets);

    if (host.includes(":")) return isPrivateIpv6(host);

    // Not an IP literal — only DNS resolution can settle it. Bare "localhost"
    // is the one hostname worth rejecting up front, since it is never a valid
    // webhook target and users reach for it by reflex.
    const h = host.toLowerCase();
    return h === "localhost" || h.endsWith(".localhost");
}

export type UrlCheck = { ok: true } | { ok: false; reason: string };

/**
 * Syntactic half of the SSRF guard: scheme, embedded credentials, and IP
 * literals. Cannot catch a hostname that *resolves* to a private address —
 * `assertPublicWebhookTarget` does that at delivery time.
 */
export function checkWebhookUrl(raw: string): UrlCheck {
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        return { ok: false, reason: "Invalid webhook URL" };
    }

    if (url.protocol !== "https:" && url.protocol !== "http:") {
        return { ok: false, reason: "Webhook URL must use http or https" };
    }

    if (url.username || url.password) {
        return { ok: false, reason: "Webhook URL must not embed credentials" };
    }

    if (isPrivateHost(url.hostname)) {
        return { ok: false, reason: "Webhook URL must not target a private or loopback address" };
    }

    return { ok: true };
}
