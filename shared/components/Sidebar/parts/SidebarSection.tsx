import type { ReactNode } from 'react';
import { cx } from '@/shared/utils/cx';
import styles from '../Sidebar.module.scss';

export interface SidebarSectionProps {
    label?: ReactNode;
    children?: ReactNode;
    className?: string;
}

export function SidebarSection({ label, children, className }: SidebarSectionProps) {
    return (
        <div className={cx(styles.section, className)}>
            {label ? <div className={styles.sectionLabel}>{label}</div> : null}
            <div className={styles.sectionItems}>{children}</div>
        </div>
    );
}
