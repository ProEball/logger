import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApiKeyAuthError } from "./api-key-auth.service";

// Mock the lookup so tests don't hit the DB
vi.mock("@/features/api-keys/services/api-keys.service", () => ({
    lookupApiKeyByPlainKey: vi.fn(),
}));

vi.mock("@/core/db/client", () => ({
    db: { update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn() })) })) },
}));

vi.mock("@/core/db/schema", () => ({ apiKeys: {} }));
vi.mock("drizzle-orm", () => ({ eq: vi.fn() }));

import { authenticateRequest } from "./api-key-auth.service";
import { lookupApiKeyByPlainKey } from "@/features/api-keys/services/api-keys.service";

const mockLookup = vi.mocked(lookupApiKeyByPlainKey);

function makeRequest(authHeader?: string): Request {
    return new Request("http://localhost/api/ingest", {
        headers: authHeader ? { authorization: authHeader } : {},
    });
}

describe("authenticateRequest", () => {
    beforeEach(() => {
        mockLookup.mockReset();
    });

    it("throws when Authorization header is missing", async () => {
        await expect(authenticateRequest(makeRequest())).rejects.toThrow(ApiKeyAuthError);
    });

    it("throws when scheme is not Bearer", async () => {
        await expect(authenticateRequest(makeRequest("Basic abc123"))).rejects.toThrow(ApiKeyAuthError);
    });

    it("throws when token does not start with lgr_", async () => {
        await expect(authenticateRequest(makeRequest("Bearer invalid_key"))).rejects.toThrow(ApiKeyAuthError);
    });

    it("throws when lookup returns null (revoked/not found)", async () => {
        mockLookup.mockResolvedValue(null);
        await expect(authenticateRequest(makeRequest("Bearer lgr_abc123"))).rejects.toThrow(ApiKeyAuthError);
    });

    it("returns project + key id when key is valid", async () => {
        mockLookup.mockResolvedValue({
            apiKey: {
                id: "key-id",
                projectId: "proj-id",
                name: "test",
                keyPrefix: "abcd",
                rateLimitPerMin: 1000,
                lastUsedAt: null,
                revokedAt: null,
                createdBy: null,
                createdAt: new Date(),
            },
            project: { id: "proj-id", organizationId: "org-id" },
        });
        const result = await authenticateRequest(makeRequest("Bearer lgr_validkey123"));
        expect(result.apiKeyId).toBe("key-id");
        expect(result.projectId).toBe("proj-id");
        expect(result.organizationId).toBe("org-id");
        expect(result.rateLimitPerMin).toBe(1000);
    });
});
