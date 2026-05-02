import { cx } from '@/shared/utils/cx';
import styles from './StatusBadge.module.scss';

export type Status = 'success' | 'warning' | 'danger' | 'info';

export interface StatusBadgeProps {
    status: Status;
    label: string;
    className?: string;
}

export function StatusBadge({ status, label, className }: StatusBadgeProps) {
    return (
        <span className={cx(styles.badge, styles[status], className)}>
            <span className={styles.dot} />
            {label}
        </span>
    );
}
