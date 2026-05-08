import { lookupApiKeyByPlainKey } from "@/features/api-keys/services/api-keys.service";
import { db } from "@/core/db/client";
import { apiKeys } from "@/core/db/schema";
import { eq } from "drizzle-orm";

export interface AuthResult {
    apiKeyId: string;
    projectId: string;
    organizationId: string;
}

export class ApiKeyAuthError extends Error {
    constructor(message = "Unauthorized") {
        super(message);
        this.name = "ApiKeyAuthError";
    }
}

/**
 * Extracts and validates the Bearer token from Authorization header.
 * Returns project + key info, or throws ApiKeyAuthError.
 */
export async function authenticateRequest(req: Request): Promise<AuthResult> {
    const header = req.headers.get("authorization");
    if (!header) throw new ApiKeyAuthError("Missing Authorization header.");

    const parts = header.split(" ");
    if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer" || !parts[1]) {
        throw new ApiKeyAuthError("Invalid Authorization header format. Expected: Bearer <key>");
    }

    const plainKey = parts[1];
    if (!plainKey.startsWith("lgr_")) {
        throw new ApiKeyAuthError("Invalid API key format.");
    }

    const result = await lookupApiKeyByPlainKey(plainKey);
    if (!result) throw new ApiKeyAuthError("Invalid or revoked API key.");

    // Debounced last_used_at update
    void updateLastUsedDebounced(result.apiKey.id);

    return {
        apiKeyId: result.apiKey.id,
        projectId: result.project.id,
        organizationId: result.project.organizationId,
    };
}

// In-memory debounce: only write to DB if >60s since last write per key
const lastUsedWriteMap = new Map<string, number>();
const DEBOUNCE_MS = 60_000;

async function updateLastUsedDebounced(apiKeyId: string): Promise<void> {
    const now = Date.now();
    const last = lastUsedWriteMap.get(apiKeyId) ?? 0;
    if (now - last < DEBOUNCE_MS) return;

    lastUsedWriteMap.set(apiKeyId, now);
    try {
        await db
            .update(apiKeys)
            .set({ lastUsedAt: new Date() })
            .where(eq(apiKeys.id, apiKeyId));
    } catch {
        // Non-critical — best effort
    }
}
