"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser } from "@/core/auth/server";
import { assertPermission } from "@/shared/permissions/guards";
import { getMembership, getOrgBySlug } from "@/features/organizations/services/organizations.service";
import { getProjectBySlug, softDeleteProject } from "@/features/projects/services/projects.service";
import { revokeAllApiKeysForProject } from "@/features/api-keys/services/api-keys.service";

const schema = z.object({
    orgSlug: z.string().min(1),
    projectSlug: z.string().min(1),
    confirmSlug: z.string().min(1),
});

type Result = { ok: true } | { error: string };

export async function deleteProjectAction(data: {
    orgSlug: string;
    projectSlug: string;
    confirmSlug: string;
}): Promise<Result> {
    const parsed = schema.safeParse(data);
    if (!parsed.success) return { error: "Invalid input." };

    if (parsed.data.confirmSlug !== parsed.data.projectSlug) {
        return { error: "Confirmation does not match project slug." };
    }

    const user = await getCurrentUser();
    if (!user) return { error: "Not authenticated." };

    const org = await getOrgBySlug(parsed.data.orgSlug);
    if (!org) return { error: "Organization not found." };

    const membership = await getMembership(user.id, org.id);
    try {
        assertPermission(membership, "projects.delete");
    } catch {
        return { error: "You don't have permission to delete projects." };
    }

    const project = await getProjectBySlug(org.id, parsed.data.projectSlug);
    if (!project) return { error: "Project not found." };

    // Revoke all API keys atomically before soft-deleting
    await revokeAllApiKeysForProject(project.id);
    await softDeleteProject(project.id);

    revalidatePath(`/${parsed.data.orgSlug}/projects`);
    return { ok: true };
}
