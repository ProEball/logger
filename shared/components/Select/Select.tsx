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
        </div>
    );
}
