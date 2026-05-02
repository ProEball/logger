import type { ReactElement } from 'react';
import { cx } from '@/shared/utils/cx';
import type { ToastItem, ToastVariant } from '../toast.types';
import styles from '../Toast.module.scss';

export interface ToastCardProps {
    toast: ToastItem;
    onDismiss: (id: string) => void;
}

const ICONS: Record<ToastVariant, ReactElement | null> = {
    default: null,
    success: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
        </svg>
    ),
    warning: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
    ),
    danger: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
    ),
    info: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
    ),
};

export function ToastCard({ toast, onDismiss }: ToastCardProps) {
    const icon = ICONS[toast.variant];
    return (
        <div className={cx(styles.toast, styles[toast.variant])}>
            {icon ? <span className={styles.icon}>{icon}</span> : null}
            <div className={styles.content}>
                {toast.title !== undefined ? (
                    <div className={styles.title}>{toast.title}</div>
                ) : null}
                {toast.body !== undefined ? (
                    <div className={styles.body}>{toast.body}</div>
                ) : null}
            </div>
            <button
                type="button"
                aria-label="Dismiss notification"
                className={styles.close}
                onClick={() => onDismiss(toast.id)}
            >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
            </button>
        </div>
    );
}
