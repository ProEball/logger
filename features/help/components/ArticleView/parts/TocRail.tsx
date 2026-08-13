"use client";

import { useEffect, useState } from "react";
import { cx } from "@/shared/utils/cx";
import styles from "./TocRail.module.scss";

export interface TocEntry {
    level: 2 | 3;
    title: string;
    anchor: string;
}

export interface TocRailProps {
    entries: TocEntry[];
}

export function TocRail({ entries }: TocRailProps) {
    const [activeAnchor, setActiveAnchor] = useState<string | null>(entries[0]?.anchor ?? null);

    useEffect(() => {
        if (entries.length === 0) return;

        const headingEls = entries
            .map((entry) => document.getElementById(entry.anchor))
            .filter((el): el is HTMLElement => el !== null);
        if (headingEls.length === 0) return;

        const observer = new IntersectionObserver(
            (observedEntries) => {
                const visible = observedEntries
                    .filter((entry) => entry.isIntersecting)
                    .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
                if (visible.length > 0) setActiveAnchor(visible[0].target.id);
            },
            { rootMargin: "0px 0px -70% 0px", threshold: 0 },
        );
        headingEls.forEach((el) => observer.observe(el));

        return () => observer.disconnect();
    }, [entries]);

    if (entries.length === 0) return null;

    return (
        <nav className={styles.rail} aria-label="On this page">
            <div className={styles.label}>On this page</div>
            {entries.map((entry) => (
                <a
                    key={entry.anchor}
                    href={`#${entry.anchor}`}
                    className={cx(
                        styles.link,
                        entry.level === 3 && styles.h3,
                        entry.anchor === activeAnchor && styles.active,
                    )}
                >
                    {entry.title}
                </a>
            ))}
        </nav>
    );
}
