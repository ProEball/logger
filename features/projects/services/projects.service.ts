import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/core/db/client";
import { projects } from "@/core/db/schema";
import { slugifyWithSuffix } from "@/features/projects/utils/slugify";

export type Project = {
    id: string;
    organizationId: string;
    name: string;
    slug: string;
    retentionDays: number;
    createdAt: Date;
    updatedAt: Date;
};

export async function listProjectsForOrg(organizationId: string): Promise<Project[]> {
    return db
        .select({
            id: projects.id,
            organizationId: projects.organizationId,
            name: projects.name,
            slug: projects.slug,
            retentionDays: projects.retentionDays,
            createdAt: projects.createdAt,
            updatedAt: projects.updatedAt,
        })
        .from(projects)
        .where(and(eq(projects.organizationId, organizationId), isNull(projects.deletedAt)));
}

export async function getProjectBySlug(
    organizationId: string,
    slug: string,
): Promise<Project | null> {
    const [row] = await db
        .select({
            id: projects.id,
            organizationId: projects.organizationId,
            name: projects.name,
            slug: projects.slug,
            retentionDays: projects.retentionDays,
            createdAt: projects.createdAt,
            updatedAt: projects.updatedAt,
        })
        .from(projects)
        .where(
            and(
                eq(projects.organizationId, organizationId),
                eq(projects.slug, slug),
                isNull(projects.deletedAt),
            ),
        )
        .limit(1);
    return row ?? null;
}

export async function getProjectById(id: string): Promise<Project | null> {
    const [row] = await db
        .select({
            id: projects.id,
            organizationId: projects.organizationId,
            name: projects.name,
            slug: projects.slug,
            retentionDays: projects.retentionDays,
            createdAt: projects.createdAt,
            updatedAt: projects.updatedAt,
        })
        .from(projects)
        .where(and(eq(projects.id, id), isNull(projects.deletedAt)))
        .limit(1);
    return row ?? null;
}

export type CreateProjectInput = {
    organizationId: string;
    name: string;
    slug: string;
};

// Inserts with collision retry on unique constraint violation (error code 23505)
export async function createProject(input: CreateProjectInput): Promise<Project> {
    const MAX_ATTEMPTS = 10;
    let lastError: unknown;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const slug = attempt === 0 ? input.slug : slugifyWithSuffix(input.name, attempt);
        try {
            const [row] = await db
                .insert(projects)
                .values({
                    organizationId: input.organizationId,
                    name: input.name,
                    slug,
                })
                .returning({
                    id: projects.id,
                    organizationId: projects.organizationId,
                    name: projects.name,
                    slug: projects.slug,
                    retentionDays: projects.retentionDays,
                    createdAt: projects.createdAt,
                    updatedAt: projects.updatedAt,
                });
            return row;
        } catch (err) {
            const code = (err as { code?: string }).code;
            if (code === "23505" && attempt < MAX_ATTEMPTS - 1) {
                lastError = err;
                continue;
            }
            throw err;
        }
    }
    throw lastError;
}

export type UpdateProjectInput = {
    name?: string;
    slug?: string;
};

export async function updateProject(id: string, input: UpdateProjectInput): Promise<Project | null> {
    const [row] = await db
        .update(projects)
        .set({
            ...(input.name !== undefined && { name: input.name }),
            ...(input.slug !== undefined && { slug: input.slug }),
            updatedAt: new Date(),
        })
        .where(and(eq(projects.id, id), isNull(projects.deletedAt)))
        .returning({
            id: projects.id,
            organizationId: projects.organizationId,
            name: projects.name,
            slug: projects.slug,
            retentionDays: projects.retentionDays,
            createdAt: projects.createdAt,
            updatedAt: projects.updatedAt,
        });
    return row ?? null;
}

export async function softDeleteProject(id: string): Promise<void> {
    await db
        .update(projects)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(projects.id, id), isNull(projects.deletedAt)));
}
