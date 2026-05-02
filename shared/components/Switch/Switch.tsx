import type { InputHTMLAttributes, ReactNode } from 'react';
import { cx } from '@/shared/utils/cx';
import styles from './Switch.module.scss';

export interface SwitchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
    label?: ReactNode;
    wrapperClassName?: string;
}

export function Switch({
    label,
    wrapperClassName,
    className,
    disabled,
    ...rest
}: SwitchProps) {
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
                role="switch"
                disabled={disabled}
                className={cx(styles.input, className)}
                {...rest}
            />
            <span aria-hidden="true" className={styles.track}>
                <span className={styles.thumb} />
            </span>
            {label !== undefined ? <span className={styles.label}>{label}</span> : null}
        </label>
    );
}
