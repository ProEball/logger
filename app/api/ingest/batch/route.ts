import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { eventSchema } from "@/features/ingest/utils/event-schema";
import { EventTimestampOutOfRetentionError } from "@/features/ingest/utils/sanitize-timestamp";
import { authenticateRequest, ApiKeyAuthError } from "@/features/ingest/services/api-key-auth.service";
import { rateLimiter } from "@/features/ingest/services/rate-limit.service";
import { ingestBatch } from "@/features/ingest/services/ingest.service";
import { extractRequestContext } from "@/features/ingest/utils/enrich-event";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const BATCH_BODY_LIMIT = 5 * 1024 * 1024; // 5 MB
const BATCH_MAX_EVENTS = 500;

export function OPTIONS(): NextResponse {
    return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: Request): Promise<NextResponse> {
    // Body size guard
    const contentLength = req.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > BATCH_BODY_LIMIT) {
        return NextResponse.json({ error: "Payload too large." }, { status: 413, headers: CORS_HEADERS });
    }

    // Auth
    let auth: Awaited<ReturnType<typeof authenticateRequest>>;
    try {
        auth = await authenticateRequest(req);
    } catch (e) {
        if (e instanceof ApiKeyAuthError) {
            return NextResponse.json({ error: e.message }, { status: 401, headers: CORS_HEADERS });
        }
        throw e;
    }

    // Parse body
    let body: unknown;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON." }, { status: 400, headers: CORS_HEADERS });
    }

    // Top-level array check + size guard
    if (!Array.isArray(body)) {
        return NextResponse.json({ error: "Expected an array of events." }, { status: 400, headers: CORS_HEADERS });
    }
    if (body.length > BATCH_MAX_EVENTS) {
        return NextResponse.json(
            { error: `Batch exceeds ${BATCH_MAX_EVENTS} events.` },
            { status: 413, headers: CORS_HEADERS },
        );
    }

    // Rate limit (count = number of events)
    const rl = rateLimiter.take(auth.apiKeyId, body.length, auth.rateLimitPerMin);
    if (!rl.allowed) {
        return NextResponse.json(
            { error: "Rate limit exceeded." },
            {
                status: 429,
                headers: { ...CORS_HEADERS, "Retry-After": String(rl.retryAfterSeconds) },
            },
        );
    }

    // Validate each event individually
    const validEvents: Array<ReturnType<typeof eventSchema.parse>> = [];
    // originalIndices[i] is the position in `body` that validEvents[i] came from
    const originalIndices: number[] = [];
    const errors: Array<{ index: number; message: string }> = [];

    for (let i = 0; i < body.length; i++) {
        const parsed = eventSchema.safeParse(body[i]);
        if (parsed.success) {
            validEvents.push(parsed.data);
            originalIndices.push(i);
        } else {
            errors.push({ index: i, message: parsed.error.flatten().fieldErrors.toString() });
        }
    }

    if (validEvents.length === 0) {
        return NextResponse.json({ accepted: 0, errors }, { status: 400, headers: CORS_HEADERS });
    }

    // Ingest valid events (ingestBatch's error indices are relative to validEvents)
    const ctx = extractRequestContext(req, auth.projectId);
    try {
        const result = await ingestBatch(validEvents, ctx);
        const remappedErrors = result.errors.map((e) => ({
            index: originalIndices[e.index],
            message: e.message,
        }));
        errors.push(...remappedErrors);
        errors.sort((a, b) => a.index - b.index);
        const status = errors.length > 0 ? 207 : 202;
        return NextResponse.json(
            { accepted: result.accepted, errors },
            { status, headers: CORS_HEADERS },
        );
    } catch (e) {
        if (e instanceof EventTimestampOutOfRetentionError) {
            return NextResponse.json({ error: e.message }, { status: 400, headers: CORS_HEADERS });
        }
        if (e instanceof ZodError) {
            return NextResponse.json(
                { error: "Validation failed.", details: e.flatten().fieldErrors },
                { status: 400, headers: CORS_HEADERS },
            );
        }
        console.error("[ingest/batch] unexpected error:", e);
        return NextResponse.json({ error: "Internal server error." }, { status: 500, headers: CORS_HEADERS });
    }
}
