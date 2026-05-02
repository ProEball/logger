import Link from 'next/link';
import type { ReactNode } from 'react';
import { cx } from '@/shared/utils/cx';
import styles from './Tabs.module.scss';

export interface TabItem {
    id: string;
    label: ReactNode;
    count?: number;
    href?: string;
    active?: boolean;
    disabled?: boolean;
}

export interface TabsProps {
    items: TabItem[];
    ariaLabel?: string;
    className?: string;
}

export function Tabs({ items, ariaLabel, className }: TabsProps) {
    return (
        <div role="tablist" aria-label={ariaLabel} className={cx(styles.tabs, className)}>
            {items.map((item) => {
                const tabClass = cx(
                    styles.tab,
                    item.active && styles.active,
                    item.disabled && styles.disabled,
                );
                const content = (
                    <>
                        <span>{item.label}</span>
                        {typeof item.count === 'number' ? (
                            <span className={styles.count}>{formatCount(item.count)}</span>
                        ) : null}
                    </>
                );
                const sharedProps = {
                    role: 'tab' as const,
                    'aria-selected': Boolean(item.active),
                    'aria-disabled': item.disabled || undefined,
                    className: tabClass,
                };
                if (item.href && !item.disabled) {
                    return (
                        <Link key={item.id} href={item.href} {...sharedProps}>
                            {content}
                        </Link>
                    );
                }
                return (
                    <span key={item.id} {...sharedProps}>
                        {content}
                    </span>
                );
            })}
        </div>
    );
}

function formatCount(count: number): string {
    if (count < 1000) {
        return String(count);
    }
    if (count < 10_000) {
        return `${(count / 1000).toFixed(1).replace(/\.0$/, '')}k`;
    }
    return `${Math.round(count / 1000)}k`;
}
