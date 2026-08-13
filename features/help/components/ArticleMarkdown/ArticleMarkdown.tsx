import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeBlock } from "@/shared/components/CodeBlock/CodeBlock";
import { getHelpCategoryBySourceFile } from "@/features/help/content/categories";
import { slugify } from "@/features/help/utils/slugify";
import { Callout } from "./parts/Callout";
import { ArticleTable } from "./parts/ArticleTable";
import styles from "./ArticleMarkdown.module.scss";

export interface ArticleMarkdownProps {
    markdown: string;
    orgSlug: string;
}

function textContent(node: ReactNode): string {
    return Children.toArray(node)
        .map((child) => {
            if (typeof child === "string") return child;
            if (typeof child === "number") return String(child);
            if (isValidElement(child)) {
                const props = child.props as { children?: ReactNode };
                return textContent(props.children);
            }
            return "";
        })
        .join("");
}

function makeHeading(level: 2 | 3) {
    const Tag = level === 2 ? "h2" : "h3";
    const className = level === 2 ? styles.h2 : styles.h3;
    return function Heading({ children }: { children?: ReactNode }) {
        const id = slugify(textContent(children));
        return (
            <Tag id={id} className={className}>
                {children}
            </Tag>
        );
    };
}

// A link to another reference doc, e.g. "security.md#rate-limiting" or "architecture.md",
// is rewritten to the in-app help route for that category. Everything else (external
// URLs, mailto:, etc.) passes through untouched.
function makeArticleLink(orgSlug: string) {
    return function ArticleLink({ href, children }: { href?: string; children?: ReactNode }) {
        const match = href ? /^([\w-]+\.md)(#.*)?$/i.exec(href) : null;
        if (match) {
            const category = getHelpCategoryBySourceFile(match[1]);
            if (category) {
                const anchor = match[2] ?? "";
                return (
                    <Link href={`/${orgSlug}/help/${category.slug}${anchor}`} className={styles.link}>
                        {children}
                    </Link>
                );
            }
        }
        const isExternal = href ? /^https?:\/\//.test(href) : false;
        return (
            <a
                href={href}
                className={styles.link}
                target={isExternal ? "_blank" : undefined}
                rel={isExternal ? "noopener noreferrer" : undefined}
            >
                {children}
            </a>
        );
    };
}

function ArticlePre({ children }: { children?: ReactNode }) {
    const codeEl = Children.only(children) as ReactElement<{ className?: string; children?: ReactNode }>;
    const className = codeEl.props.className ?? "";
    const language = /language-(\w+)/.exec(className)?.[1];
    const code = textContent(codeEl.props.children).replace(/\n$/, "");
    return <CodeBlock code={code} language={language} showLineNumbers={false} className={styles.codeBlock} />;
}

function ArticleInlineCode({ children }: { children?: ReactNode }) {
    return <code className={styles.inlineCode}>{children}</code>;
}

export function ArticleMarkdown({ markdown, orgSlug }: ArticleMarkdownProps) {
    return (
        <div className={styles.article}>
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                    h2: makeHeading(2),
                    h3: makeHeading(3),
                    table: ArticleTable,
                    blockquote: Callout,
                    pre: ArticlePre,
                    code: ArticleInlineCode,
                    a: makeArticleLink(orgSlug),
                }}
            >
                {markdown}
            </ReactMarkdown>
        </div>
    );
}
