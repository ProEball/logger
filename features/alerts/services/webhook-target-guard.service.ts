import { lookup } from "node:dns/promises";
import { env } from "@/core/env";
import { checkWebhookUrl, isPrivateHost } from "@/features/alerts/utils/webhook-url";

export class UnsafeWebhookTargetError extends Error {
    constructor(reason: string) {
        super(reason);
        this.name = "UnsafeWebhookTargetError";
    }
}

/**
 * Server-side SSRF guard, run immediately before every webhook delivery.
 *
 * The syntactic checks in `checkWebhookUrl` stop the obvious cases, but a
 * hostname the attacker controls can resolve to 169.254.169.254 (cloud
 * metadata) or an address on the host's own LAN. So the hostname is resolved
 * here and *every* address it answers with is checked.
 *
 * Self-hosted installs that legitimately post to a service on the same network
 * can opt out with ALLOW_PRIVATE_WEBHOOK_TARGETS=true.
 */
export async function assertPublicWebhookTarget(raw: string): Promise<void> {
    if (env.ALLOW_PRIVATE_WEBHOOK_TARGETS) return;

    const syntactic = checkWebhookUrl(raw);
    if (!syntactic.ok) {
        throw new UnsafeWebhookTargetError(syntactic.reason);
    }

    const { hostname } = new URL(raw);

    // An IP literal was already settled by checkWebhookUrl — no DNS to do.
    if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname.includes(":")) return;

    let addresses: Array<{ address: string }>;
    try {
        addresses = await lookup(hostname, { all: true });
    } catch {
        throw new UnsafeWebhookTargetError(`Could not resolve webhook host ${hostname}`);
    }

    // `all: true` never yields an empty list on success, but an empty result
    // would otherwise vacuously pass the check below.
    if (addresses.length === 0) {
        throw new UnsafeWebhookTargetError(`Could not resolve webhook host ${hostname}`);
    }

    for (const { address } of addresses) {
        if (isPrivateHost(address)) {
            throw new UnsafeWebhookTargetError(
                `Webhook host ${hostname} resolves to a private address`,
            );
        }
    }
}
