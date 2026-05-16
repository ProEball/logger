import type { ReactNode } from 'react';
import { cx } from '@/shared/utils/cx';
import styles from './AppShell.module.scss';

export interface AppShellProps {
    rail?: ReactNode;
    sidebar?: ReactNode;
    children?: ReactNode;
    className?: string;
}

export function AppShell({ rail, sidebar, children, className }: AppShellProps) {
    return (
        <div className={cx(styles.shell, className)}>
            <div className={styles.rail}>{rail}</div>
            <div className={styles.sidebarCol}>{sidebar}</div>
            <main className={styles.content}>{children}</main>
        </div>
    );
}
