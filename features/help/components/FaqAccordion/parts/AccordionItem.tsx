"use client";

import { useState } from "react";
import Link from "next/link";
import { cx } from "@/shared/utils/cx";
import { IconChevronRight } from "@/features/help/components/icons";
import styles from "./AccordionItem.module.scss";

export interface AccordionItemProps {
    question: string;
    answer: string;
    defaultOpen?: boolean;
    readMoreHref?: string;
}

export function AccordionItem({ question, answer, defaultOpen = false, readMoreHref }: AccordionItemProps) {
    const [open, setOpen] = useState(defaultOpen);

    return (
        <div className={cx(styles.item, open && styles.itemOpen)}>
            <button
                type="button"
                className={styles.question}
                onClick={() => setOpen((prev) => !prev)}
                aria-expanded={open}
            >
                <span className={styles.text}>{question}</span>
                <span className={styles.chev}>
                    <IconChevronRight />
                </span>
            </button>
            {open ? (
                <div className={styles.answer}>
                    <p>{answer}</p>
                    {readMoreHref ? (
                        <Link href={readMoreHref} className={styles.readMore}>
                            Read full article →
                        </Link>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}
