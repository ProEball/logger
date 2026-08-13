import { describe, it, expect } from "vitest";
import { getArticleMarkdown, HelpArticleNotFoundError } from "./help-content.service";

describe("getArticleMarkdown", () => {
    it("reads the source file for a known category and strips its leading H1", async () => {
        const article = await getArticleMarkdown("api");

        expect(article.category.slug).toBe("api");
        expect(article.rawMarkdown.startsWith("# API")).toBe(true);
        expect(article.markdown.startsWith("# API")).toBe(false);
        expect(article.markdown).toContain("## Ingest API");
    });

    it("throws HelpArticleNotFoundError for an unknown slug", async () => {
        await expect(getArticleMarkdown("not-a-real-category")).rejects.toThrow(HelpArticleNotFoundError);
    });
});
