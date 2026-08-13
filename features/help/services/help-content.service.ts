import { readFile } from "fs/promises";
import path from "path";
import { getHelpCategory, type HelpCategory } from "@/features/help/content/categories";

const REFERENCE_DIR = path.join(process.cwd(), "docs", "reference");

export class HelpArticleNotFoundError extends Error {
    constructor(slug: string) {
        super(`Unknown help category: ${slug}`);
        this.name = "HelpArticleNotFoundError";
    }
}

export interface HelpArticle {
    category: HelpCategory;
    /** Raw markdown source, with the leading H1 stripped (the UI renders the category label as the page title instead). */
    markdown: string;
    /** Raw markdown source exactly as stored on disk — used by the "Copy page as Markdown" action. */
    rawMarkdown: string;
}

function stripLeadingHeading(markdown: string): string {
    const lines = markdown.split("\n");
    let i = 0;
    while (i < lines.length && lines[i].trim() === "") i++;
    if (i < lines.length && /^#\s+/.test(lines[i])) {
        lines.splice(i, 1);
        while (i < lines.length && lines[i].trim() === "") lines.splice(i, 1);
    }
    return lines.join("\n");
}

export async function getArticleMarkdown(slug: string): Promise<HelpArticle> {
    const category = getHelpCategory(slug);
    if (!category) throw new HelpArticleNotFoundError(slug);

    const filePath = path.join(REFERENCE_DIR, category.sourceFile);
    const rawMarkdown = await readFile(filePath, "utf-8");

    return {
        category,
        markdown: stripLeadingHeading(rawMarkdown),
        rawMarkdown,
    };
}
