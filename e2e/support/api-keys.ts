import { randomBytes, createHash } from "crypto";

// Mirrors features/api-keys/utils/key-generator.ts — duplicated here because
// e2e specs seed keys directly in the DB rather than through the app.
export function generateApiKey(): string {
    return `lgr_${randomBytes(32).toString("base64url")}`;
}

export function extractKeyPrefix(key: string): string {
    return key.slice(4, 8);
}

export function hashApiKey(key: string): string {
    return createHash("sha256").update(key).digest("hex");
}
