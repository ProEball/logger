'use client';

import { Button } from '@/shared/components/Button/Button';
import styles from './ErrorBoundary.module.scss';

interface GlobalErrorPageProps {
    error: Error & { digest?: string };
    reset: () => void;
}

export function GlobalErrorPage({ reset }: GlobalErrorPageProps) {
    return (
        <div className={styles.page}>
            <svg
                className={styles.icon}
                width="48"
                height="48"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
            >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <h1 className={styles.title}>Something went wrong</h1>
            <p className={styles.body}>
                We encountered an unexpected error. Please try again or go back to the home page.
            </p>
            <div className={styles.actions}>
                <Button variant="primary" onClick={reset}>Try again</Button>
                <a href="/" className={styles.link}>Go to home</a>
            </div>
        </div>
    );
}
