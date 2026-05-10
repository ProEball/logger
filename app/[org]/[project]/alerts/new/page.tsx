import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/core/auth/server";
import { getOrgBySlug, getMembership } from "@/features/organizations/services/organizations.service";
import { getProjectBySlug } from "@/features/projects/services/projects.service";
import { assertPermission } from "@/shared/permissions/guards";
import { AlertRuleEditor } from "@/features/alerts/components/AlertRuleEditor/AlertRuleEditor";
import { ForbiddenPage } from "@/shared/components/ErrorBoundary/ForbiddenPage";

interface NewAlertPageProps {
    params: Promise<{ org: string; project: string }>;
}

export const dynamic = "force-dynamic";

export default async function NewAlertPage({ params }: NewAlertPageProps) {
    const { org: orgSlug, project: projectSlug } = await params;

    const user = await getCurrentUser();
    if (!user) redirect("/login");

    const org = await getOrgBySlug(orgSlug);
    if (!org) notFound();

    const membership = await getMembership(user.id, org.id);
    if (!membership) redirect("/login");

    try {
        assertPermission(membership, "alerts.manage");
    } catch {
        return <ForbiddenPage />;
    }

    const project = await getProjectBySlug(org.id, projectSlug);
    if (!project) notFound();

    return (
        <AlertRuleEditor
            orgSlug={orgSlug}
            projectSlug={projectSlug}
        />
    );
}
