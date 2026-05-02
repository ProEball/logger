import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from '@/shared/utils/cx';
import styles from './Button.module.scss';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ButtonVariant;
    size?: ButtonSize;
    leftIcon?: ReactNode;
    rightIcon?: ReactNode;
}

export function Button({
    variant = 'secondary',
    size = 'md',
    leftIcon,
    rightIcon,
    children,
    className,
    type = 'button',
    ...rest
}: ButtonProps) {
    return (
        <button
            type={type}
            className={cx(styles.btn, styles[variant], styles[size], className)}
            {...rest}
        >
            {leftIcon ? <span className={styles.icon}>{leftIcon}</span> : null}
            <span className={styles.label}>{children}</span>
            {rightIcon ? <span className={styles.icon}>{rightIcon}</span> : null}
        </button>
    );
}
