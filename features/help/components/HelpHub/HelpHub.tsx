import Link from "next/link";
import { HELP_FAQ } from "@/features/help/content/faq";
import { AccordionItem } from "@/features/help/components/FaqAccordion/parts/AccordionItem";
import { CategoryGrid } from "./parts/CategoryGrid";
import { SearchTrigger } from "./parts/SearchTrigger";
import styles from "./HelpHub.module.scss";

export interface HelpHubProps {
    orgSlug: string;
}

const FAQ_PREVIEW_COUNT = 5;

export function HelpHub({ orgSlug }: HelpHubProps) {
    const preview = HELP_FAQ.slice(0, FAQ_PREVIEW_COUNT);

    return (
        <div className={styles.page}>
            <div>
                <h1 className={styles.title}>Help</h1>
                <span className={styles.subtitle}>
                    Reference documentation for this Logger instance. Available to every member regardless of role.
                </span>
            </div>

            <SearchTrigger />

            <CategoryGrid orgSlug={orgSlug} />

            <div>
                <div className={styles.sectionHead}>
                    <h2 className={styles.sectionTitle}>Frequently asked questions</h2>
                    <Link href={`/${orgSlug}/help/faq`} className={styles.viewAll}>
                        View all
                    </Link>
                </div>
                <div className={styles.acc}>
                    {preview.map((entry) => (
                        <AccordionItem
                            key={entry.id}
                            question={entry.question}
                            answer={entry.answer}
                            readMoreHref={`/${orgSlug}/help/${entry.cat}${entry.anchor ? `#${entry.anchor}` : ""}`}
                        />
                    ))}
                </div>
            </div>
        </div>
    );
}
