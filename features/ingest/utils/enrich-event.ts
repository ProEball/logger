import type { IngestEvent } from "./event-schema";
import { sanitizeTimestamp } from "./sanitize-timestamp";
import { fingerprintMessage } from "./normalize-message";
import { uuidv7 } from "@/shared/utils/uuidv7";
import { dedupTokenFromRequest } from "./dedup-token";
import type { NewEvent } from "@/shared/types/event.types";

export interface RequestContext {
    userAgent: string | null;
    ip: string | null;
    projectId: string;
    /**
     * `insert_deduplication_token` for this request, or `null` when the caller
     * did not send an idempotency key. Per request rather than per event: what
     * an SDK retries is a request.
     */
    dedupToken: string | null;
}

/**
 * Takes a Zod-parsed ingest event and a request context,
 * adds server-side fields, returns a DB-ready NewEvent row.
 */
export function enrichEvent(raw: IngestEvent, ctx: RequestContext): NewEvent {
    // One pass of the normaliser for both halves. Until Phase 4 the hash was
    // computed here and the display text again in a registry service, on the
    // grounds that threading one result through two modules was not worth the
    // microseconds; with the template stored on the row there is one caller
    // and no thread to pull.
    const fingerprint = fingerprintMessage(raw.message);

    return {
        // UUIDv7, not v4. Phase 0 measured `id` at compression ratio 1.0 and a
        // fifth of the ClickHouse table (§14.2) — see `shared/utils/uuidv7.ts`.
        id: uuidv7(),
        projectId: ctx.projectId,
        timestamp: sanitizeTimestamp(raw.timestamp),
        level: raw.level,
        message: raw.message,
        source: raw.source ?? null,
        environment: raw.environment ?? null,
        release: raw.release ?? null,
        userId: raw.user_id ?? null,
        sessionId: raw.session_id ?? null,
        requestId: raw.request_id ?? null,
        traceId: raw.trace_id ?? null,
        errorType: raw.error_type ?? null,
        stackTrace: raw.stack_trace ?? null,
        attributes: raw.attributes,
        context: raw.context,
        // Server-filled — override any client value
        userAgent: ctx.userAgent,
        ip: ctx.ip,

        templateHash: fingerprint.hash,
        messageTemplate: fingerprint.template,
    };
}

/**
 * Extracts request context fields from a Next.js Request.
 */
export function extractRequestContext(
    req: Request,
    projectId: string,
): RequestContext {
    const userAgent = req.headers.get("user-agent");
    const forwarded = req.headers.get("x-forwarded-for");
    const ip = forwarded ? forwarded.split(",")[0].trim() : null;
    return { userAgent, ip, projectId, dedupToken: dedupTokenFromRequest(req, projectId) };
}
