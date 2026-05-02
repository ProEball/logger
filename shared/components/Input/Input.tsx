import type { InputHTMLAttributes, ReactNode } from 'react';
import { cx } from '@/shared/utils/cx';
import styles from './Input.module.scss';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'prefix' | 'size'> {
    prefix?: ReactNode;
    suffix?: ReactNode;
    invalid?: boolean;
    wrapperClassName?: string;
}

export function Input({
    prefix,
    suffix,
    invalid = false,
    wrapperClassName,
    className,
    ...rest
}: InputProps) {
    return (
        <div
            className={cx(
                styles.wrapper,
                invalid && styles.invalid,
                rest.disabled && styles.disabled,
                wrapperClassName,
            )}
        >
            {prefix ? <span className={styles.affix}>{prefix}</span> : null}
            <input className={cx(styles.input, className)} {...rest} />
            {suffix ? <span className={styles.affix}>{suffix}</span> : null}
        </div>
    );
}
