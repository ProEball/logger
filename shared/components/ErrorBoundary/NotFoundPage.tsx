import Link from 'next/link';
import styles from './ErrorBoundary.module.scss';

export function NotFoundPage() {
    return (
        <div className={styles.page}>
            <span className={styles.codeText} aria-hidden="true">404</span>
            <h1 className={styles.title}>Page not found</h1>
            <p className={styles.body}>
                The page you&#39;re looking for doesn&#39;t exist or has been moved.
            </p>
            <div className={styles.actions}>
                <Link href="/" className={styles.link}>Back to dashboard</Link>
            </div>
        </div>
    );
}
