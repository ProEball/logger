import type { ReactNode } from 'react';
import { cx } from '@/shared/utils/cx';
import styles from './FilterBar.module.scss';

export interface FilterBarProps {
    children?: ReactNode;
    className?: string;
}

export function FilterBar({ children, className }: FilterBarProps) {
    return (
        <div role="toolbar" aria-label="Filters" className={cx(styles.bar, className)}>
            {children}
        </div>
    );
}
