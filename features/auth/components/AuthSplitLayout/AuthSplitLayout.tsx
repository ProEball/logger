import type { ReactNode } from "react";
import { BrandPanel } from "./parts/BrandPanel";
import styles from "./AuthSplitLayout.module.scss";

interface AuthSplitLayoutProps {
    children: ReactNode;
}

export function AuthSplitLayout({ children }: AuthSplitLayoutProps) {
    return (
        <div className={styles.split}>
            <BrandPanel />

            <main className={styles.formPanel}>
                <div className={styles.mobileLogo}>
                    <span className={styles.mmark}>&gt;_</span>
                    <b>Logger</b>
                </div>
                {children}
            </main>
        </div>
    );
}
