'use client';

import { Button } from '@/shared/components/Button/Button';
import styles from './ErrorBoundary.module.scss';

export function ForbiddenPage() {
    return (
        <div className={styles.page}>
            <span className={styles.codeText} aria-hidden="true">403</span>
            <h1 className={styles.title}>Access denied</h1>
            <p className={styles.body}>
                You don&#39;t have permission to view this page.
                Ask your organization admin to grant you access.
            </p>
            <div className={styles.actions}>
                <Button variant="ghost" onClick={() => window.history.back()}>Go back</Button>
            </div>
        </div>
    );
}
