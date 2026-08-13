import { HELP_CATEGORIES, type HelpCategorySlug } from "@/features/help/content/categories";
import { HELP_FAQ } from "@/features/help/content/faq";
import { getArticleMarkdown } from "./help-content.service";
import { slugify } from "@/features/help/utils/slugify";

export interface HelpSearchEntry {
    id: string;
    cat: HelpCategorySlug;
    title: string;
    /** Heading anchor within the article, or undefined for a FAQ entry (routed to /help/faq instead). */
    anchor?: string;
    kind: "heading" | "faq";
}

const HEADING_LINE = /^(#{2,3})\s+(.+)$/;

export function extractHeadings(markdown: string): { level: 2 | 3; title: string; anchor: string }[] {
    const headings: { level: 2 | 3; title: string; anchor: string }[] = [];
    for (const line of markdown.split("\n")) {
        const match = HEADING_LINE.exec(line.trim());
        if (!match) continue;
        const level = match[1].length as 2 | 3;
        const title = match[2].replace(/`/g, "").trim();
        headings.push({ level, title, anchor: slugify(title) });
    }
    return headings;
}

/** Builds a flat, serializable search index across every category's headings plus the FAQ — passed as props into the client-side search palette. */
export async function buildHelpSearchIndex(): Promise<HelpSearchEntry[]> {
    const entries: HelpSearchEntry[] = [];

    const articles = await Promise.all(
        HELP_CATEGORIES.map((category) => getArticleMarkdown(category.slug)),
    );

    for (const article of articles) {
        for (const heading of extractHeadings(article.markdown)) {
            entries.push({
                id: `${article.category.slug}:${heading.anchor}`,
                cat: article.category.slug,
                title: heading.title,
                anchor: heading.anchor,
                kind: "heading",
            });
        }
    }

    for (const faq of HELP_FAQ) {
        entries.push({ id: `faq:${faq.id}`, cat: faq.cat, title: faq.question, kind: "faq" });
    }

    return entries;
}
