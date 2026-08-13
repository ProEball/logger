import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/core/auth/server";
import { getMembership, getOrgBySlug } from "@/features/organizations/services/organizations.service";
import { HELP_FAQ } from "@/features/help/content/faq";
import { FaqAccordion } from "@/features/help/components/FaqAccordion/FaqAccordion";
import styles from "./page.module.scss";

interface HelpFaqPageProps {
    params: Promise<{ org: string }>;
}

export const metadata = { title: "FAQ — Help — Logger" };

export default async function HelpFaqPage({ params }: HelpFaqPageProps) {
    const { org: slug } = await params;

    const user = await getCurrentUser();
    if (!user) redirect("/login");

    const org = await getOrgBySlug(slug);
    if (!org) notFound();

    const membership = await getMembership(user.id, org.id);
    if (!membership) redirect("/login");

    return (
        <div className={styles.page}>
            <div>
                <h1 className={styles.title}>Frequently asked questions</h1>
                <span className={styles.subtitle}>Answers drawn from the reference documentation, phrased as questions.</span>
            </div>
            <FaqAccordion orgSlug={org.slug} faq={HELP_FAQ} />
        </div>
    );
}
