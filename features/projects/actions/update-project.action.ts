"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser } from "@/core/auth/server";
import { assertPermission } from "@/shared/permissions/guards";
import { getMembership, getOrgBySlug } from "@/features/organizations/services/organizations.service";
import { getProjectBySlug, updateProject } from "@/features/projects/services/projects.service";

const schema = z.object({
    orgSlug: z.string().min(1),
    projectSlug: z.string().min(1),
    name: z.string().min(2).max(80).optional(),
    newSlug: z.string().regex(/^[a-z0-9-]+$/).min(2).max(60).optional(),
});

type Result = { newSlug?: string } | { error: string };

export async function updateProjectAction(data: {
    orgSlug: string;
    projectSlug: string;
    name?: string;
    newSlug?: string;
}): Promise<Result> {
    const parsed = schema.safeParse(data);
    if (!parsed.success) return { error: "Invalid input." };

    const user = await getCurrentUser();
    if (!user) return { error: "Not authenticated." };

    const org = await getOrgBySlug(parsed.data.orgSlug);
    if (!org) return { error: "Organization not found." };

    const membership = await getMembership(user.id, org.id);
    try {
        assertPermission(membership, "projects.update");
    } catch {
        return { error: "You don't have permission to update projects." };
    }

    const project = await getProjectBySlug(org.id, parsed.data.projectSlug);
    if (!project) return { error: "Project not found." };

    try {
        await updateProject(project.id, {
            name: parsed.data.name,
            slug: parsed.data.newSlug,
        });
    } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === "23505") {
            return { error: "A project with this slug already exists." };
        }
        return { error: "Failed to update project." };
    }

    const slugChanged = parsed.data.newSlug && parsed.data.newSlug !== parsed.data.projectSlug;
    revalidatePath(`/${parsed.data.orgSlug}/${parsed.data.newSlug ?? parsed.data.projectSlug}/settings`);

    if (slugChanged) {
        return { newSlug: parsed.data.newSlug };
    }
    return {};
}
