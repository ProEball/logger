import type { ReactNode } from 'react';
import { cx } from '@/shared/utils/cx';
import styles from './AppShell.module.scss';

export interface AppShellProps {
    sidebar?: ReactNode;
    children?: ReactNode;
    className?: string;
}

export function AppShell({ sidebar, children, className }: AppShellProps) {
    return (
        <div className={cx(styles.shell, className)}>
            <div className={styles.sidebarCol}>{sidebar}</div>
            <main className={styles.content}>{children}</main>
        </div>
    );
}
