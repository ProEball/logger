import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/core/auth/server";
import { getOrgBySlug, getMembership } from "@/features/organizations/services/organizations.service";
import { getProjectBySlug } from "@/features/projects/services/projects.service";
import { getAlertRule, listAlertHistory } from "@/features/alerts/services/alert-rules.service";
import { AlertRuleEditor } from "@/features/alerts/components/AlertRuleEditor/AlertRuleEditor";

interface AlertDetailPageProps {
    params: Promise<{ org: string; project: string; id: string }>;
}

export const dynamic = "force-dynamic";

export default async function AlertDetailPage({ params }: AlertDetailPageProps) {
    const { org: orgSlug, project: projectSlug, id: ruleId } = await params;

    const user = await getCurrentUser();
    if (!user) redirect("/login");

    const org = await getOrgBySlug(orgSlug);
    if (!org) notFound();

    const membership = await getMembership(user.id, org.id);
    if (!membership) redirect("/login");

    const project = await getProjectBySlug(org.id, projectSlug);
    if (!project) notFound();

    const rule = await getAlertRule(project.id, ruleId, membership);
    if (!rule) notFound();

    const { notifications, total } = await listAlertHistory(ruleId, project.id, membership, 0);

    return (
        <AlertRuleEditor
            rule={rule}
            notifications={notifications}
            notificationsTotal={total}
            orgSlug={orgSlug}
            projectSlug={projectSlug}
        />
    );
}
