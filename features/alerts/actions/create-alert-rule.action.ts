"use server";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/core/auth/server";
import { getMembership, getOrgBySlug } from "@/features/organizations/services/organizations.service";
import { getProjectBySlug } from "@/features/projects/services/projects.service";
import { createAlertRule } from "@/features/alerts/services/alert-rules.service";
import { createAlertRuleSchema } from "@/features/alerts/utils/alert-schemas";
import type { CreateAlertRuleInput } from "@/features/alerts/utils/alert-schemas";
import { assertPermission } from "@/shared/permissions/guards";

type Result = { id: string } | { error: string };

export async function createAlertRuleAction(
    orgSlug: string,
    projectSlug: string,
    input: CreateAlertRuleInput,
): Promise<Result> {
    const parsed = createAlertRuleSchema.safeParse(input);
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
        const rule = await createAlertRule(project.id, parsed.data, user.id, membership!);
        revalidatePath(`/${orgSlug}/${projectSlug}/alerts`);
        return { id: rule.id };
    } catch {
        return { error: "Failed to create alert rule." };
    }
}
