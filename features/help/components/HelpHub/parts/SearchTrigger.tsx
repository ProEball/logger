"use client";

import { useHelpSearch } from "@/features/help/components/HelpSearchProvider/HelpSearchProvider";
import { IconSearch } from "@/features/help/components/icons";
import styles from "./SearchTrigger.module.scss";

export function SearchTrigger() {
    const { openSearch } = useHelpSearch();

    return (
        <button type="button" className={styles.bar} onClick={openSearch}>
            <IconSearch />
            <span className={styles.placeholder}>Search docs and FAQ…</span>
            <kbd className={styles.kbd}>/</kbd>
        </button>
    );
}
