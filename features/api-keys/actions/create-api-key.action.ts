"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser } from "@/core/auth/server";
import { assertPermission } from "@/shared/permissions/guards";
import { getMembership, getOrgBySlug } from "@/features/organizations/services/organizations.service";
import { getProjectBySlug } from "@/features/projects/services/projects.service";
import { generateAndStoreApiKey } from "@/features/api-keys/services/api-keys.service";

const schema = z.object({
    orgSlug: z.string().min(1),
    projectSlug: z.string().min(1),
    name: z.string().min(1).max(80),
});

type Result = { plainKey: string; keyId: string; keyPrefix: string } | { error: string };

export async function createApiKeyAction(data: {
    orgSlug: string;
    projectSlug: string;
    name: string;
}): Promise<Result> {
    const parsed = schema.safeParse(data);
    if (!parsed.success) return { error: "Invalid input." };

    const user = await getCurrentUser();
    if (!user) return { error: "Not authenticated." };

    const org = await getOrgBySlug(parsed.data.orgSlug);
    if (!org) return { error: "Organization not found." };

    const membership = await getMembership(user.id, org.id);
    try {
        assertPermission(membership, "api_keys.manage");
    } catch {
        return { error: "You don't have permission to manage API keys." };
    }

    const project = await getProjectBySlug(org.id, parsed.data.projectSlug);
    if (!project) return { error: "Project not found." };

    try {
        const result = await generateAndStoreApiKey(project.id, parsed.data.name, user.id);
        revalidatePath(`/${parsed.data.orgSlug}/${parsed.data.projectSlug}/settings/api-keys`);
        return { plainKey: result.plainKey, keyId: result.id, keyPrefix: result.keyPrefix };
    } catch {
        return { error: "Failed to create API key." };
    }
}
