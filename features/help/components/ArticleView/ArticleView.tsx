import type { HelpCategory } from "@/features/help/content/categories";
import { extractHeadings } from "@/features/help/services/search-index.service";
import { ArticleMarkdown } from "@/features/help/components/ArticleMarkdown/ArticleMarkdown";
import { CategoryRail } from "./parts/CategoryRail";
import { TocRail } from "./parts/TocRail";
import { CopyMarkdownButton } from "./parts/CopyMarkdownButton";
import styles from "./ArticleView.module.scss";

export interface ArticleViewProps {
    orgSlug: string;
    category: HelpCategory;
    markdown: string;
    rawMarkdown: string;
}

export function ArticleView({ orgSlug, category, markdown, rawMarkdown }: ArticleViewProps) {
    const toc = extractHeadings(markdown);

    return (
        <div className={styles.layout}>
            <CategoryRail orgSlug={orgSlug} activeSlug={category.slug} />

            <article className={styles.center}>
                <div className={styles.util}>
                    <CopyMarkdownButton markdown={rawMarkdown} />
                </div>
                <div className={styles.head}>
                    <h1 className={styles.title}>{category.label}</h1>
                    <p className={styles.subtitle}>{category.description}</p>
                </div>
                <ArticleMarkdown markdown={markdown} orgSlug={orgSlug} />
            </article>

            <TocRail entries={toc} />
        </div>
    );
}
