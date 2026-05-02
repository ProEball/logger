import type { ToastItem } from '../toast.types';
import { ToastCard } from './ToastCard';
import styles from '../Toast.module.scss';

export interface ToastListProps {
    toasts: ToastItem[];
    onDismiss: (id: string) => void;
}

export function ToastList({ toasts, onDismiss }: ToastListProps) {
    return (
        <div
            className={styles.region}
            role="region"
            aria-live="polite"
            aria-label="Notifications"
        >
            {toasts.map((toast) => (
                <ToastCard key={toast.id} toast={toast} onDismiss={onDismiss} />
            ))}
        </div>
    );
}
