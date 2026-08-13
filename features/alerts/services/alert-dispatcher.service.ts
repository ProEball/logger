import { eq, sql } from "drizzle-orm";
import { db } from "@/core/db/client";
import { alertNotifications } from "@/core/db/schema";
import {
    assertPublicWebhookTarget,
    UnsafeWebhookTargetError,
} from "@/features/alerts/services/webhook-target-guard.service";

const WEBHOOK_TIMEOUT_MS = 5_000;

type DeliveryResult =
    | { ok: true; status: number }
    | { ok: false; status?: number; error: string; shouldRetry: boolean };

export async function deliverWebhook(
    url: string,
    payload: Record<string, unknown>,
    headers: Array<{ key: string; value: string }> = [],
): Promise<DeliveryResult> {
    const customHeaders: Record<string, string> = {};
    for (const { key, value } of headers) {
        customHeaders[key] = value;
    }

    // Re-checked on every delivery rather than only at rule-creation time: DNS
    // for a host that was public yesterday can be repointed inward today.
    try {
        await assertPublicWebhookTarget(url);
    } catch (err) {
        const reason = err instanceof UnsafeWebhookTargetError ? err.message : String(err);
        return { ok: false, error: reason, shouldRetry: false };
    }

    let status: number | undefined;

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

        const res = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...customHeaders,
            },
            body: JSON.stringify(payload),
            // Following a 3xx would re-enter the request with a Location the
            // guard above never vetted — the classic SSRF bypass.
            redirect: "manual",
            signal: controller.signal,
        });

        clearTimeout(timeoutId);
        status = res.status;

        if (res.ok) {
            return { ok: true, status };
        }

        if (status >= 300 && status < 400) {
            return { ok: false, status, error: "Webhook redirected; refusing to follow", shouldRetry: false };
        }

        // 4xx — configuration error, no retry
        if (status >= 400 && status < 500) {
            return { ok: false, status, error: `HTTP ${status}`, shouldRetry: false };
        }

        // 5xx — transient, retry
        return { ok: false, status, error: `HTTP ${status}`, shouldRetry: true };
    } catch (err) {
        const isTimeout = err instanceof Error && err.name === "AbortError";
        const message = isTimeout ? "Request timed out" : String(err);
        return { ok: false, error: message, shouldRetry: true };
    }
}

export async function deliver(
    notificationId: string,
    url: string,
    payload: Record<string, unknown>,
    headers: Array<{ key: string; value: string }> = [],
): Promise<void> {
    const now = new Date();

    await db
        .update(alertNotifications)
        .set({ deliveryAttempts: sql`${alertNotifications.deliveryAttempts} + 1` })
        .where(eq(alertNotifications.id, notificationId));

    const result = await deliverWebhook(url, payload, headers);

    if (result.ok) {
        await db
            .update(alertNotifications)
            .set({
                deliveryStatus: "delivered",
                deliveryHttpStatus: result.status,
                deliveredAt: now,
            })
            .where(eq(alertNotifications.id, notificationId));
        return;
    }

    const isFinal = !result.shouldRetry;

    await db
        .update(alertNotifications)
        .set({
            deliveryStatus: isFinal ? "failed" : "retrying",
            deliveryHttpStatus: result.status ?? null,
            deliveryLastError: result.error,
        })
        .where(eq(alertNotifications.id, notificationId));

    if (result.shouldRetry) {
        // Throw so pg-boss retries the job with backoff
        throw new Error(result.error);
    }
}
