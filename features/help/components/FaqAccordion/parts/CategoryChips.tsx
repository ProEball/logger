"use client";

import { HELP_CATEGORIES, type HelpCategorySlug } from "@/features/help/content/categories";
import { cx } from "@/shared/utils/cx";
import styles from "./CategoryChips.module.scss";

export interface CategoryChipsProps {
    value: HelpCategorySlug | "all";
    onChange: (value: HelpCategorySlug | "all") => void;
}

export function CategoryChips({ value, onChange }: CategoryChipsProps) {
    return (
        <div className={styles.chips} role="tablist" aria-label="Filter FAQ by category">
            <button
                type="button"
                role="tab"
                aria-selected={value === "all"}
                className={cx(styles.chip, value === "all" && styles.chipActive)}
                onClick={() => onChange("all")}
            >
                All
            </button>
            {HELP_CATEGORIES.map((category) => (
                <button
                    key={category.slug}
                    type="button"
                    role="tab"
                    aria-selected={value === category.slug}
                    className={cx(styles.chip, value === category.slug && styles.chipActive)}
                    onClick={() => onChange(category.slug)}
                >
                    {category.label}
                </button>
            ))}
        </div>
    );
}
