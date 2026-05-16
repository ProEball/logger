'use client';

import type { ReactNode } from 'react';
import { cx } from '@/shared/utils/cx';
import styles from './FilterBar.module.scss';

export type FilterChipVariant = 'red' | 'green' | 'cyan' | 'purple' | 'orange';

export interface FilterChipProps {
    filterKey: ReactNode;
    value: ReactNode;
    operator?: ReactNode;
    variant?: FilterChipVariant;
    onRemove?: () => void;
    className?: string;
}

const VARIANT_CLASS: Record<FilterChipVariant, string> = {
    red:    styles.chipRed,
    green:  styles.chipGreen,
    cyan:   styles.chipCyan,
    purple: styles.chipPurple,
    orange: styles.chipOrange,
};

export function FilterChip({
    filterKey,
    value,
    operator = ':',
    variant,
    onRemove,
    className,
}: FilterChipProps) {
    return (
        <span className={cx(styles.chip, variant ? VARIANT_CLASS[variant] : undefined, className)}>
            <span className={styles.chipKey}>
                {filterKey}
                {operator}
            </span>
            <span className={styles.chipVal}>{value}</span>
            {onRemove ? (
                <button
                    type="button"
                    aria-label={`Remove filter ${typeof filterKey === 'string' ? filterKey : ''}`}
                    className={styles.chipRemove}
                    onClick={onRemove}
                >
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                </button>
            ) : null}
        </span>
    );
}
