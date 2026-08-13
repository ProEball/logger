import type { ReactNode } from "react";
import styles from "./ArticleTable.module.scss";

export interface ArticleTableProps {
    children?: ReactNode;
}

export function ArticleTable({ children }: ArticleTableProps) {
    return (
        <div className={styles.scroll}>
            <table className={styles.table}>{children}</table>
        </div>
    );
}
