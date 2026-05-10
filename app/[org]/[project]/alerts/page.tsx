import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/core/auth/server";
import { getOrgBySlug, getMembership } from "@/features/organizations/services/organizations.service";
import { getProjectBySlug } from "@/features/projects/services/projects.service";
import { listAlertRules } from "@/features/alerts/services/alert-rules.service";
import { AlertsList } from "@/features/alerts/components/AlertsList/AlertsList";
import { hasPermission } from "@/shared/permissions/check";

interface AlertsPageProps {
    params: Promise<{ org: string; project: string }>;
}

export const dynamic = "force-dynamic";

export default async function AlertsPage({ params }: AlertsPageProps) {
    const { org: orgSlug, project: projectSlug } = await params;

    const user = await getCurrentUser();
    if (!user) redirect("/login");

    const org = await getOrgBySlug(orgSlug);
    if (!org) notFound();

    const membership = await getMembership(user.id, org.id);
    if (!membership) redirect("/login");

    const project = await getProjectBySlug(org.id, projectSlug);
    if (!project) notFound();

    const canManage = hasPermission(membership, "alerts.manage");

    const [enabledRules, allRules] = await Promise.all([
        listAlertRules(project.id, membership, false),
        listAlertRules(project.id, membership, true),
    ]);

    return (
        <AlertsList
            rules={enabledRules}
            allRules={allRules}
            orgSlug={orgSlug}
            projectSlug={projectSlug}
            canManage={canManage}
        />
    );
}
