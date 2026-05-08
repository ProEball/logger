import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { eventSchema } from "@/features/ingest/utils/event-schema";
import { EventTimestampOutOfRetentionError } from "@/features/ingest/utils/sanitize-timestamp";
import { authenticateRequest, ApiKeyAuthError } from "@/features/ingest/services/api-key-auth.service";
import { rateLimiter } from "@/features/ingest/services/rate-limit.service";
import { ingestSingle } from "@/features/ingest/services/ingest.service";
import { extractRequestContext } from "@/features/ingest/utils/enrich-event";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const SINGLE_BODY_LIMIT = 64 * 1024; // 64 KB

export function OPTIONS(): NextResponse {
    return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: Request): Promise<NextResponse> {
    // Body size guard
    const contentLength = req.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > SINGLE_BODY_LIMIT) {
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

    // Rate limit
    const rl = rateLimiter.take(auth.apiKeyId);
    if (!rl.allowed) {
        return NextResponse.json(
            { error: "Rate limit exceeded." },
            {
                status: 429,
                headers: { ...CORS_HEADERS, "Retry-After": String(rl.retryAfterSeconds) },
            },
        );
    }

    // Parse body
    let body: unknown;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON." }, { status: 400, headers: CORS_HEADERS });
    }

    // Validate
    const parsed = eventSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json(
            { error: "Validation failed.", details: parsed.error.flatten().fieldErrors },
            { status: 400, headers: CORS_HEADERS },
        );
    }

    // Ingest
    const ctx = extractRequestContext(req, auth.projectId);
    try {
        const result = await ingestSingle(parsed.data, ctx);
        return NextResponse.json(result, { status: 202, headers: CORS_HEADERS });
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
        console.error("[ingest] unexpected error:", e);
        return NextResponse.json({ error: "Internal server error." }, { status: 500, headers: CORS_HEADERS });
    }
}
