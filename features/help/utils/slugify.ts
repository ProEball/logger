/**
 * Slugifies heading text for use as an anchor id. Must produce identical output whether
 * called on React-rendered heading children (backticks already stripped by the markdown
 * parser) or on raw markdown heading text (backticks still present) — see
 * search-index.service.ts and ArticleMarkdown's heading renderer, which both rely on this.
 */
export function slugify(text: string): string {
    return text
        .replace(/`/g, "")
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}
