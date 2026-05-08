import { randomBytes } from "crypto";

export function generateApiKey(): string {
    const bytes = randomBytes(32);
    const b64 = bytes
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=/g, "");
    return `lgr_${b64}`;
}

export function extractKeyPrefix(key: string): string {
    // lgr_XXXX... → first 4 chars after "lgr_"
    return key.slice(4, 8);
}
