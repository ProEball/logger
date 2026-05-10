"use server";
import { z } from "zod";
import { getCurrentUser } from "@/core/auth/server";
import { getMembership, getOrgBySlug } from "@/features/organizations/services/organizations.service";
import { getProjectBySlug } from "@/features/projects/services/projects.service";
import { getAlertRule } from "@/features/alerts/services/alert-rules.service";
import { buildPayload } from "@/features/alerts/utils/build-payload";
import { deliverWebhook } from "@/features/alerts/services/alert-dispatcher.service";
import { assertPermission } from "@/shared/permissions/guards";
import type { WebhookChannel } from "@/features/alerts/utils/alert-schemas";

const schema = z.object({ ruleId: z.string().uuid() });

type Result = { ok: true; httpStatus: number } | { error: string };

export async function testAlertRuleAction(
    orgSlug: string,
    projectSlug: string,
    ruleId: string,
): Promise<Result> {
    const parsed = schema.safeParse({ ruleId });
    if (!parsed.success) return { error: "Invalid rule ID." };

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

    const rule = await getAlertRule(project.id, parsed.data.ruleId, membership!);
    if (!rule) return { error: "Alert rule not found." };

    const channels = rule.channels as WebhookChannel[];
    if (!channels.length) return { error: "No channels configured." };

    const payload = await buildPayload(
        rule,
        "firing",
        "ok",
        new Date(),
        orgSlug,
        projectSlug,
        true, // isTest
    );

    const firstChannel = channels[0]!;
    const result = await deliverWebhook(
        firstChannel.url,
        payload as Record<string, unknown>,
        firstChannel.headers ?? [],
    );

    if (result.ok) {
        return { ok: true, httpStatus: result.status };
    }

    return { error: `Delivery failed: ${result.error}${result.status ? ` (HTTP ${result.status})` : ""}` };
}
