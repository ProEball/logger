import type { InputHTMLAttributes, ReactNode } from 'react';
import { cx } from '@/shared/utils/cx';
import styles from './Radio.module.scss';

export interface RadioProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
    label?: ReactNode;
    wrapperClassName?: string;
}

export function Radio({
    label,
    wrapperClassName,
    className,
    disabled,
    ...rest
}: RadioProps) {
    return (
        <label
            className={cx(
                styles.row,
                disabled && styles.disabled,
                wrapperClassName,
            )}
        >
            <input
                type="radio"
                disabled={disabled}
                className={cx(styles.input, className)}
                {...rest}
            />
            <span aria-hidden="true" className={styles.outer}>
                <span className={styles.inner} />
            </span>
            {label !== undefined ? <span className={styles.label}>{label}</span> : null}
        </label>
    );
}
