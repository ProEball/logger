"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser } from "@/core/auth/server";
import { getMembership, getOrgBySlug } from "@/features/organizations/services/organizations.service";
import { getProjectBySlug } from "@/features/projects/services/projects.service";
import { toggleAlertRule } from "@/features/alerts/services/alert-rules.service";
import { assertPermission } from "@/shared/permissions/guards";

const schema = z.object({
    ruleId: z.string().uuid(),
    enabled: z.boolean(),
});

type Result = { ok: true } | { error: string };

export async function toggleAlertRuleAction(
    orgSlug: string,
    projectSlug: string,
    ruleId: string,
    enabled: boolean,
): Promise<Result> {
    const parsed = schema.safeParse({ ruleId, enabled });
    if (!parsed.success) return { error: "Invalid input." };

    const user = await getCurrentUser();
    if (!user) return { error: "Not authenticated." };

    const org = await getOrgBySlug(orgSlug);
    if (!org) return { error: "Organization not found." };

    const membership = await getMembership(user.id, org.id);
    try {
        assertPermission(membership, "alerts.manage");
    } catch {
        return { error: "You don't have permission to manage alerts." };
    }

    const project = await getProjectBySlug(org.id, projectSlug);
    if (!project) return { error: "Project not found." };

    try {
        await toggleAlertRule(project.id, parsed.data.ruleId, parsed.data.enabled, membership!);
        revalidatePath(`/${orgSlug}/${projectSlug}/alerts`);
        return { ok: true };
    } catch {
        return { error: "Failed to toggle alert rule." };
    }
}
