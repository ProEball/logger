import Link from "next/link";
import { HELP_CATEGORIES, type HelpCategorySlug } from "@/features/help/content/categories";
import { CategoryIcon } from "@/features/help/components/icons";
import { cx } from "@/shared/utils/cx";
import styles from "./CategoryRail.module.scss";

export interface CategoryRailProps {
    orgSlug: string;
    activeSlug: HelpCategorySlug;
}

export function CategoryRail({ orgSlug, activeSlug }: CategoryRailProps) {
    return (
        <nav className={styles.rail} aria-label="Help categories">
            <div className={styles.label}>Categories</div>
            {HELP_CATEGORIES.map((category) => (
                <Link
                    key={category.slug}
                    href={`/${orgSlug}/help/${category.slug}`}
                    className={cx(styles.item, category.slug === activeSlug && styles.itemActive)}
                >
                    <span className={styles.icon}>
                        <CategoryIcon icon={category.icon} />
                    </span>
                    {category.label}
                </Link>
            ))}
        </nav>
    );
}
