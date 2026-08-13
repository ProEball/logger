import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/core/auth/server";
import { getMembership, getOrgBySlug } from "@/features/organizations/services/organizations.service";
import { HelpHub } from "@/features/help/components/HelpHub/HelpHub";

interface HelpPageProps {
    params: Promise<{ org: string }>;
}

export const metadata = { title: "Help — Logger" };

export default async function HelpPage({ params }: HelpPageProps) {
    const { org: slug } = await params;

    const user = await getCurrentUser();
    if (!user) redirect("/login");

    const org = await getOrgBySlug(slug);
    if (!org) notFound();

    const membership = await getMembership(user.id, org.id);
    if (!membership) redirect("/login");

    return <HelpHub orgSlug={org.slug} />;
}
