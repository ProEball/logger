import { randomUUID } from "crypto";
import type { IngestEvent } from "./event-schema";
import { sanitizeTimestamp } from "./sanitize-timestamp";
import { templateHashForStorage } from "./normalize-message";
import type { NewEvent } from "@/core/db/schema";

export interface RequestContext {
    userAgent: string | null;
    ip: string | null;
    projectId: string;
}

/**
 * Takes a Zod-parsed ingest event and a request context,
 * adds server-side fields, returns a DB-ready NewEvent row.
 */
export function enrichEvent(raw: IngestEvent, ctx: RequestContext): NewEvent {
    return {
        id: randomUUID(),
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

        // Computed here so the value is written with the event in one
        // statement. The registry normalises the same message again for its
        // display text: two passes rather than threading one result through
        // two functions, because the normaliser costs microseconds against a
        // 0.2 ms insert and PROJECT.md §10 asks for evidence before cleverness.
        templateHash: templateHashForStorage(raw.message),
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
    return { userAgent, ip, projectId };
}
