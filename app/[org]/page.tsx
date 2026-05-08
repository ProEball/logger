import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/core/auth/server";
import { getOrgBySlug, getMembership } from "@/features/organizations/services/organizations.service";

interface OrgPageProps {
    params: Promise<{ org: string }>;
}

export default async function OrgPage({ params }: OrgPageProps) {
    const { org: slug } = await params;

    const user = await getCurrentUser();
    if (!user) redirect("/login");

    const org = await getOrgBySlug(slug);
    if (!org) notFound();

    const membership = await getMembership(user.id, org.id);
    if (!membership) redirect("/login");

    return (
        <main style={{ padding: "var(--space-8)" }}>
            <h1 style={{ font: "var(--type-h2)", marginBottom: "var(--space-2)" }}>
                {org.name}
            </h1>
            <p style={{ font: "var(--type-body-sm)", color: "var(--text-secondary)" }}>
                Dashboard coming soon.
            </p>
        </main>
    );
}
