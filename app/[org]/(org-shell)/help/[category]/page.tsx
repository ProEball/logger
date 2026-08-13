import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/core/auth/server";
import { getMembership, getOrgBySlug } from "@/features/organizations/services/organizations.service";
import { getArticleMarkdown, HelpArticleNotFoundError } from "@/features/help/services/help-content.service";
import { ArticleView } from "@/features/help/components/ArticleView/ArticleView";

interface HelpArticlePageProps {
    params: Promise<{ org: string; category: string }>;
}

export const metadata = { title: "Help — Logger" };

export default async function HelpArticlePage({ params }: HelpArticlePageProps) {
    const { org: slug, category } = await params;

    const user = await getCurrentUser();
    if (!user) redirect("/login");

    const org = await getOrgBySlug(slug);
    if (!org) notFound();

    const membership = await getMembership(user.id, org.id);
    if (!membership) redirect("/login");

    let article;
    try {
        article = await getArticleMarkdown(category);
    } catch (err) {
        if (err instanceof HelpArticleNotFoundError) notFound();
        throw err;
    }

    return (
        <ArticleView
            orgSlug={org.slug}
            category={article.category}
            markdown={article.markdown}
            rawMarkdown={article.rawMarkdown}
        />
    );
}
