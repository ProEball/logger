"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser } from "@/core/auth/server";
import { assertPermission } from "@/shared/permissions/guards";
import { getMembership, getOrgBySlug } from "@/features/organizations/services/organizations.service";
import { revokeApiKey } from "@/features/api-keys/services/api-keys.service";

const schema = z.object({
    orgSlug: z.string().min(1),
    projectSlug: z.string().min(1),
    keyId: z.string().uuid(),
});

type Result = { ok: true } | { error: string };

export async function revokeApiKeyAction(data: {
    orgSlug: string;
    projectSlug: string;
    keyId: string;
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

    await revokeApiKey(parsed.data.keyId);
    revalidatePath(`/${parsed.data.orgSlug}/${parsed.data.projectSlug}/settings/api-keys`);
    return { ok: true };
}
