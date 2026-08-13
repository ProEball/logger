"use client";

import { useState } from "react";
import { HELP_CATEGORIES, type HelpCategorySlug } from "@/features/help/content/categories";
import type { HelpFaqEntry } from "@/features/help/content/faq";
import { EmptyState } from "@/shared/components";
import { IconSearchOff } from "@/features/help/components/icons";
import { AccordionItem } from "./parts/AccordionItem";
import { CategoryChips } from "./parts/CategoryChips";
import styles from "./FaqAccordion.module.scss";

export interface FaqAccordionProps {
    orgSlug: string;
    faq: HelpFaqEntry[];
}

function readMoreHref(orgSlug: string, entry: HelpFaqEntry): string {
    return `/${orgSlug}/help/${entry.cat}${entry.anchor ? `#${entry.anchor}` : ""}`;
}

export function FaqAccordion({ orgSlug, faq }: FaqAccordionProps) {
    const [filter, setFilter] = useState<HelpCategorySlug | "all">("all");
    const items = filter === "all" ? faq : faq.filter((entry) => entry.cat === filter);

    return (
        <div>
            <CategoryChips value={filter} onChange={setFilter} />

            {items.length === 0 ? (
                <div className={styles.acc}>
                    <EmptyState
                        icon={<IconSearchOff />}
                        title="No questions match your filter"
                        description="Try another category, or reset to All."
                    />
                </div>
            ) : (
                <div className={styles.acc}>
                    {filter === "all"
                        ? HELP_CATEGORIES.filter((category) => items.some((entry) => entry.cat === category.slug)).map(
                            (category) => (
                                <div key={category.slug}>
                                    <div className={styles.groupLabel}>{category.label}</div>
                                    {items
                                        .filter((entry) => entry.cat === category.slug)
                                        .map((entry) => (
                                            <AccordionItem
                                                key={entry.id}
                                                question={entry.question}
                                                answer={entry.answer}
                                                readMoreHref={readMoreHref(orgSlug, entry)}
                                            />
                                        ))}
                                </div>
                            ),
                        )
                        : items.map((entry) => (
                            <AccordionItem
                                key={entry.id}
                                question={entry.question}
                                answer={entry.answer}
                                readMoreHref={readMoreHref(orgSlug, entry)}
                            />
                        ))}
                </div>
            )}
        </div>
    );
}
