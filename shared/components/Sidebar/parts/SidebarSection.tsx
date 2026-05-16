"use client";

import type { ReactNode } from 'react';
import { cx } from '@/shared/utils/cx';
import styles from '../Sidebar.module.scss';

export interface SidebarSectionProps {
    label?: ReactNode;
    children?: ReactNode;
    onAdd?: () => void;
    className?: string;
}

export function SidebarSection({ label, children, onAdd, className }: SidebarSectionProps) {
    return (
        <div className={cx(styles.section, className)}>
            {label ? (
                <div className={styles.sectionLabel}>
                    <span className={styles.sectionLabelText}>{label}</span>
                    {onAdd ? (
                        <button
                            type="button"
                            className={styles.sectionAdd}
                            onClick={onAdd}
                            aria-label="Add item"
                        >
                            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                                <path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                            </svg>
                        </button>
                    ) : null}
                </div>
            ) : null}
            <div className={styles.sectionItems}>{children}</div>
        </div>
    );
}
