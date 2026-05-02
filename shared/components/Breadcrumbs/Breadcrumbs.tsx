import Link from 'next/link';
import { Fragment, type ReactNode } from 'react';
import { cx } from '@/shared/utils/cx';
import styles from './Breadcrumbs.module.scss';

export interface BreadcrumbItem {
    label: ReactNode;
    href?: string;
}

export interface BreadcrumbsProps {
    items: BreadcrumbItem[];
    separator?: ReactNode;
    className?: string;
    ariaLabel?: string;
}

export function Breadcrumbs({
    items,
    separator = '›',
    className,
    ariaLabel = 'Breadcrumb',
}: BreadcrumbsProps) {
    return (
        <nav aria-label={ariaLabel} className={cx(styles.nav, className)}>
            <ol className={styles.list}>
                {items.map((item, idx) => {
                    const isLast = idx === items.length - 1;
                    return (
                        <Fragment key={idx}>
                            <li
                                className={cx(styles.item, isLast && styles.current)}
                                aria-current={isLast ? 'page' : undefined}
                            >
                                {item.href && !isLast ? (
                                    <Link href={item.href} className={styles.link}>
                                        {item.label}
                                    </Link>
                                ) : (
                                    <span>{item.label}</span>
                                )}
                            </li>
                            {!isLast ? (
                                <li className={styles.separator} aria-hidden>
                                    {separator}
                                </li>
                            ) : null}
                        </Fragment>
                    );
                })}
            </ol>
        </nav>
    );
}
