import type { InputHTMLAttributes, ReactNode } from 'react';
import { cx } from '@/shared/utils/cx';
import styles from './Checkbox.module.scss';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
    label?: ReactNode;
    wrapperClassName?: string;
}

export function Checkbox({
    label,
    wrapperClassName,
    className,
    disabled,
    ...rest
}: CheckboxProps) {
    return (
        <label
            className={cx(
                styles.row,
                disabled && styles.disabled,
                wrapperClassName,
            )}
        >
            <input
                type="checkbox"
                disabled={disabled}
                className={cx(styles.input, className)}
                {...rest}
            />
            <span aria-hidden="true" className={styles.box}>
                <svg
                    className={styles.check}
                    width="9"
                    height="9"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#fff"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                >
                    <polyline points="20 6 9 17 4 12" />
                </svg>
            </span>
            {label !== undefined ? <span className={styles.label}>{label}</span> : null}
        </label>
    );
}
