import Link from 'next/link';
import type { ReactNode } from 'react';
import { cx } from '@/shared/utils/cx';
import styles from '../Sidebar.module.scss';

export interface SidebarItemProps {
    icon?: ReactNode;
    label: ReactNode;
    href?: string;
    active?: boolean;
    badge?: ReactNode;
    dot?: boolean;
    count?: ReactNode;
    className?: string;
}

export function SidebarItem({ icon, label, href, active, badge, dot, count, className }: SidebarItemProps) {
    const itemClass = cx(styles.item, active && styles.itemActive, className);
    const content = (
        <>
            {icon ? <span className={styles.itemIcon}>{icon}</span> : null}
            <span className={styles.itemLabel}>{label}</span>
            {dot ? <span className={styles.dot} aria-hidden="true" /> : null}
            {count !== undefined ? <span className={styles.count}>{count}</span> : null}
            {badge ? <span className={styles.itemBadge}>{badge}</span> : null}
        </>
    );
    if (href) {
        return (
            <Link
                href={href}
                className={itemClass}
                aria-current={active ? 'page' : undefined}
            >
                {content}
            </Link>
        );
    }
    return (
        <span className={itemClass} aria-current={active ? 'page' : undefined}>
            {content}
        </span>
    );
}
