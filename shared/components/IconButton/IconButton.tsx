import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from '@/shared/utils/cx';
import styles from './IconButton.module.scss';

export type IconButtonSize = 'sm' | 'md';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    size?: IconButtonSize;
    active?: boolean;
    children: ReactNode;
}

export function IconButton({
    size = 'md',
    active = false,
    children,
    className,
    type = 'button',
    ...rest
}: IconButtonProps) {
    return (
        <button
            type={type}
            className={cx(
                styles.btn,
                styles[size],
                active && styles.active,
                className,
            )}
            {...rest}
        >
            {children}
        </button>
    );
}
