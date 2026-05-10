"use server";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/core/auth/server";
import { getMembership, getOrgBySlug } from "@/features/organizations/services/organizations.service";
import { getProjectBySlug } from "@/features/projects/services/projects.service";
import { updateAlertRule } from "@/features/alerts/services/alert-rules.service";
import { updateAlertRuleSchema } from "@/features/alerts/utils/alert-schemas";
import type { UpdateAlertRuleInput } from "@/features/alerts/utils/alert-schemas";
import { assertPermission } from "@/shared/permissions/guards";

type Result = { ok: true } | { error: string };

export async function updateAlertRuleAction(
    orgSlug: string,
    projectSlug: string,
    input: UpdateAlertRuleInput,
): Promise<Result> {
    const parsed = updateAlertRuleSchema.safeParse(input);
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
        await updateAlertRule(project.id, parsed.data, membership!);
        revalidatePath(`/${orgSlug}/${projectSlug}/alerts`);
        return { ok: true };
    } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to update alert rule.";
        return { error: msg };
    }
}
