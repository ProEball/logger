import type { ReactNode } from 'react';
import { cx } from '@/shared/utils/cx';
import styles from './EmptyState.module.scss';

export interface EmptyStateProps {
    icon?: ReactNode;
    title: string;
    description?: string;
    cta?: ReactNode;
    className?: string;
}

export function EmptyState({ icon, title, description, cta, className }: EmptyStateProps) {
    return (
        <div className={cx(styles.root, className)}>
            {icon ? <div className={styles.iconBox}>{icon}</div> : null}
            <h4 className={styles.title}>{title}</h4>
            {description ? <p className={styles.description}>{description}</p> : null}
            {cta ? <div className={styles.cta}>{cta}</div> : null}
        </div>
    );
}
