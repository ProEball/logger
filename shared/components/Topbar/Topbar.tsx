import type { ReactNode } from 'react';
import { cx } from '@/shared/utils/cx';
import styles from './Topbar.module.scss';

export interface TopbarProps {
    left?: ReactNode;
    right?: ReactNode;
    children?: ReactNode;
    className?: string;
}

export function Topbar({ left, right, children, className }: TopbarProps) {
    return (
        <header className={cx(styles.topbar, className)}>
            {left ? <div className={styles.left}>{left}</div> : null}
            {children ? <div className={styles.center}>{children}</div> : null}
            {right ? <div className={styles.right}>{right}</div> : null}
        </header>
    );
}
