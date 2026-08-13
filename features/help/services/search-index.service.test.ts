import { describe, it, expect } from "vitest";
import { extractHeadings, buildHelpSearchIndex } from "./search-index.service";

describe("extractHeadings", () => {
    it("extracts H2 and H3 headings with slugified anchors, ignoring H1 and inline code/backticks", () => {
        const markdown = [
            "# Title (ignored)",
            "",
            "## Ingest API",
            "",
            "### `POST /api/ingest` — single event",
            "",
            "Some body text with a ## fake heading inside a sentence is not extracted since it's not line-start... actually this line starts with text not #",
        ].join("\n");

        const headings = extractHeadings(markdown);

        expect(headings).toEqual([
            { level: 2, title: "Ingest API", anchor: "ingest-api" },
            { level: 3, title: "POST /api/ingest — single event", anchor: "post-api-ingest-single-event" },
        ]);
    });

    it("returns an empty array for markdown with no H2/H3 headings", () => {
        expect(extractHeadings("# Just a title\n\nSome text.")).toEqual([]);
    });
});

describe("buildHelpSearchIndex", () => {
    it("includes at least one heading entry per category plus every FAQ question", async () => {
        const entries = await buildHelpSearchIndex();

        const categories = new Set(entries.filter((e) => e.kind === "heading").map((e) => e.cat));
        expect(categories.size).toBe(8);

        const faqEntries = entries.filter((e) => e.kind === "faq");
        expect(faqEntries.length).toBeGreaterThan(0);
        expect(faqEntries.every((e) => e.anchor === undefined)).toBe(true);
    });
});
