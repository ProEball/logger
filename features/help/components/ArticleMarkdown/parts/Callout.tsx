import type { ReactNode } from "react";
import { IconAlert } from "@/features/help/components/icons";
import styles from "./Callout.module.scss";

export interface CalloutProps {
    children?: ReactNode;
}

export function Callout({ children }: CalloutProps) {
    return (
        <div className={styles.callout}>
            <span className={styles.icon}><IconAlert /></span>
            <div className={styles.body}>{children}</div>
        </div>
    );
}
