import type { ReactNode, SelectHTMLAttributes } from 'react';
import { cx } from '@/shared/utils/cx';
import styles from './Select.module.scss';

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
    invalid?: boolean;
    wrapperClassName?: string;
    children: ReactNode;
}

export function Select({
    invalid = false,
    wrapperClassName,
    className,
    children,
    disabled,
    ...rest
}: SelectProps) {
    return (
        <div
            className={cx(
                styles.wrapper,
                invalid && styles.invalid,
                disabled && styles.disabled,
                wrapperClassName,
            )}
        >
            <select
                disabled={disabled}
                className={cx(styles.select, className)}
                {...rest}
            >
                {children}
            </select>
            <svg
                aria-hidden="true"
                className={styles.chevron}
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
            >
                <polyline points="6 9 12 15 18 9" />
            </svg>
        </div>
    );
}
