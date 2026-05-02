import type { ReactNode } from 'react';
import { cx } from '@/shared/utils/cx';
import styles from './AppShell.module.scss';

export interface AppShellProps {
    sidebar?: ReactNode;
    topbar?: ReactNode;
    children?: ReactNode;
    className?: string;
}

export function AppShell({ sidebar, topbar, children, className }: AppShellProps) {
    return (
        <div className={cx(styles.shell, className)}>
            {sidebar}
            <div className={styles.main}>
                {topbar}
                <div className={styles.content}>{children}</div>
            </div>
        </div>
    );
}
