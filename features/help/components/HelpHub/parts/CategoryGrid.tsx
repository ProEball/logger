import Link from "next/link";
import { HELP_CATEGORIES } from "@/features/help/content/categories";
import { CategoryIcon, IconChevronRight } from "@/features/help/components/icons";
import styles from "./CategoryGrid.module.scss";

export interface CategoryGridProps {
    orgSlug: string;
}

export function CategoryGrid({ orgSlug }: CategoryGridProps) {
    return (
        <div className={styles.grid}>
            {HELP_CATEGORIES.map((category) => (
                <Link key={category.slug} href={`/${orgSlug}/help/${category.slug}`} className={styles.card}>
                    <span className={styles.icon}>
                        <CategoryIcon icon={category.icon} />
                    </span>
                    <span className={styles.body}>
                        <b className={styles.label}>{category.label}</b>
                        <span className={styles.desc}>{category.description}</span>
                    </span>
                    <span className={styles.chev}>
                        <IconChevronRight />
                    </span>
                </Link>
            ))}
        </div>
    );
}
