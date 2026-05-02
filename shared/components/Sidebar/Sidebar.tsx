import type { ReactNode } from 'react';
import { cx } from '@/shared/utils/cx';
import styles from './Sidebar.module.scss';

export interface SidebarProps {
    top?: ReactNode;
    bottom?: ReactNode;
    children?: ReactNode;
    collapsed?: boolean;
    width?: number | string;
    collapsedWidth?: number | string;
    className?: string;
    ariaLabel?: string;
}

export function Sidebar({
    top,
    bottom,
    children,
    collapsed = false,
    width = 'var(--sidebar-width)',
    collapsedWidth = '56px',
    className,
    ariaLabel = 'Primary',
}: SidebarProps) {
    const widthValue = typeof width === 'number' ? `${width}px` : width;
    const collapsedValue = typeof collapsedWidth === 'number' ? `${collapsedWidth}px` : collapsedWidth;
    return (
        <aside
            aria-label={ariaLabel}
            data-collapsed={collapsed || undefined}
            className={cx(styles.sidebar, className)}
            style={
                {
                    '--sidebar-w': widthValue,
                    '--sidebar-w-collapsed': collapsedValue,
                } as React.CSSProperties
            }
        >
            {top ? <div className={styles.top}>{top}</div> : null}
            <div className={styles.body}>{children}</div>
            {bottom ? <div className={styles.bottom}>{bottom}</div> : null}
        </aside>
    );
}
