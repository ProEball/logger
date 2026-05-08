"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser } from "@/core/auth/server";
import { assertPermission } from "@/shared/permissions/guards";
import { getMembership, getOrgBySlug } from "@/features/organizations/services/organizations.service";
import { createProject } from "@/features/projects/services/projects.service";
import { slugify } from "@/features/projects/utils/slugify";

const schema = z.object({
    orgSlug: z.string().min(1),
    name: z.string().min(2).max(80),
    slug: z.string().regex(/^[a-z0-9-]+$/).min(2).max(60).optional(),
});

type Result = { project: { slug: string; orgSlug: string } } | { error: string };

export async function createProjectAction(data: {
    orgSlug: string;
    name: string;
    slug?: string;
}): Promise<Result> {
    const parsed = schema.safeParse(data);
    if (!parsed.success) return { error: "Invalid input." };

    const user = await getCurrentUser();
    if (!user) return { error: "Not authenticated." };

    const org = await getOrgBySlug(parsed.data.orgSlug);
    if (!org) return { error: "Organization not found." };

    const membership = await getMembership(user.id, org.id);
    try {
        assertPermission(membership, "projects.create");
    } catch {
        return { error: "You don't have permission to create projects." };
    }

    const resolvedSlug = parsed.data.slug ?? slugify(parsed.data.name);

    try {
        const project = await createProject({
            organizationId: org.id,
            name: parsed.data.name,
            slug: resolvedSlug,
        });
        revalidatePath(`/${parsed.data.orgSlug}/projects`);
        return { project: { slug: project.slug, orgSlug: org.slug } };
    } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === "23505") {
            return { error: "A project with this slug already exists. Choose a different name or slug." };
        }
        return { error: "Failed to create project." };
    }
}
