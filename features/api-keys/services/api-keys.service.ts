import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/core/db/client";
import { apiKeys, projects } from "@/core/db/schema";
import { generateApiKey, extractKeyPrefix } from "@/features/api-keys/utils/key-generator";
import { hashApiKey } from "@/features/api-keys/utils/key-hash";

export type ApiKey = {
    id: string;
    projectId: string;
    name: string;
    keyPrefix: string;
    rateLimitPerMin: number;
    lastUsedAt: Date | null;
    revokedAt: Date | null;
    createdBy: string | null;
    createdAt: Date;
};

export type ApiKeyWithPlainKey = ApiKey & { plainKey: string };

export async function listApiKeysForProject(projectId: string): Promise<ApiKey[]> {
    return db
        .select({
            id: apiKeys.id,
            projectId: apiKeys.projectId,
            name: apiKeys.name,
            keyPrefix: apiKeys.keyPrefix,
            rateLimitPerMin: apiKeys.rateLimitPerMin,
            lastUsedAt: apiKeys.lastUsedAt,
            revokedAt: apiKeys.revokedAt,
            createdBy: apiKeys.createdBy,
            createdAt: apiKeys.createdAt,
        })
        .from(apiKeys)
        .where(eq(apiKeys.projectId, projectId))
        .orderBy(apiKeys.createdAt);
}

export async function generateAndStoreApiKey(
    projectId: string,
    name: string,
    createdBy: string,
    rateLimitPerMin: number,
): Promise<ApiKeyWithPlainKey> {
    const plainKey = generateApiKey();
    const keyHash = hashApiKey(plainKey);
    const keyPrefix = extractKeyPrefix(plainKey);

    const [row] = await db
        .insert(apiKeys)
        .values({ projectId, name, keyHash, keyPrefix, createdBy, rateLimitPerMin })
        .returning({
            id: apiKeys.id,
            projectId: apiKeys.projectId,
            name: apiKeys.name,
            keyPrefix: apiKeys.keyPrefix,
            rateLimitPerMin: apiKeys.rateLimitPerMin,
            lastUsedAt: apiKeys.lastUsedAt,
            revokedAt: apiKeys.revokedAt,
            createdBy: apiKeys.createdBy,
            createdAt: apiKeys.createdAt,
        });

    return { ...row, plainKey };
}

export async function updateApiKeyRateLimit(id: string, rateLimitPerMin: number): Promise<void> {
    await db
        .update(apiKeys)
        .set({ rateLimitPerMin })
        .where(and(eq(apiKeys.id, id), isNull(apiKeys.revokedAt)));
}

export async function lookupApiKeyByPlainKey(
    plainKey: string,
): Promise<{ apiKey: ApiKey; project: { id: string; organizationId: string } } | null> {
    const keyHash = hashApiKey(plainKey);
    const [row] = await db
        .select({
            id: apiKeys.id,
            projectId: apiKeys.projectId,
            name: apiKeys.name,
            keyPrefix: apiKeys.keyPrefix,
            rateLimitPerMin: apiKeys.rateLimitPerMin,
            lastUsedAt: apiKeys.lastUsedAt,
            revokedAt: apiKeys.revokedAt,
            createdBy: apiKeys.createdBy,
            createdAt: apiKeys.createdAt,
            projectOrgId: projects.organizationId,
        })
        .from(apiKeys)
        .innerJoin(projects, eq(apiKeys.projectId, projects.id))
        .where(and(eq(apiKeys.keyHash, keyHash), isNull(apiKeys.revokedAt), isNull(projects.deletedAt)))
        .limit(1);

    if (!row) return null;
    return {
        apiKey: {
            id: row.id,
            projectId: row.projectId,
            name: row.name,
            keyPrefix: row.keyPrefix,
            rateLimitPerMin: row.rateLimitPerMin,
            lastUsedAt: row.lastUsedAt,
            revokedAt: row.revokedAt,
            createdBy: row.createdBy,
            createdAt: row.createdAt,
        },
        project: { id: row.projectId, organizationId: row.projectOrgId },
    };
}

export async function revokeApiKey(id: string): Promise<void> {
    await db
        .update(apiKeys)
        .set({ revokedAt: new Date() })
        .where(and(eq(apiKeys.id, id), isNull(apiKeys.revokedAt)));
}

export async function revokeAllApiKeysForProject(projectId: string): Promise<void> {
    await db
        .update(apiKeys)
        .set({ revokedAt: new Date() })
        .where(and(eq(apiKeys.projectId, projectId), isNull(apiKeys.revokedAt)));
}

/** Permanently removes a key. Only allowed once revoked — active keys must be revoked first. */
export async function deleteApiKey(id: string): Promise<void> {
    await db
        .delete(apiKeys)
        .where(and(eq(apiKeys.id, id), isNotNull(apiKeys.revokedAt)));
}
