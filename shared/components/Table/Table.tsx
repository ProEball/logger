'use client';

import type { ReactNode } from 'react';
import { cx } from '@/shared/utils/cx';
import { Skeleton } from '@/shared/components/Skeleton/Skeleton';
import styles from './Table.module.scss';

export type SortDirection = 'asc' | 'desc' | null;

export type RowVariant = 'default' | 'error' | 'fatal';

export interface TableColumn<T> {
    key: string;
    header: ReactNode;
    width?: number | string;
    align?: 'left' | 'right' | 'center';
    numeric?: boolean;
    dim?: boolean;
    sortable?: boolean;
    render: (row: T) => ReactNode;
}

export interface TableRowMeta {
    id: string;
    variant?: RowVariant;
    selected?: boolean;
}

export interface TableProps<T extends TableRowMeta> {
    columns: TableColumn<T>[];
    rows: T[];
    sortKey?: string;
    sortDirection?: SortDirection;
    onSort?: (key: string) => void;
    onRowClick?: (row: T) => void;
    stickyHeader?: boolean;
    loading?: boolean;
    skeletonRows?: number;
    ariaLabel?: string;
    className?: string;
}

function alignClass(align?: 'left' | 'right' | 'center'): string | undefined {
    if (align === 'left') return styles.alignLeft;
    if (align === 'right') return styles.alignRight;
    if (align === 'center') return styles.alignCenter;
    return undefined;
}

function variantClass(variant?: RowVariant): string | undefined {
    if (variant === 'error') return styles.rowError;
    if (variant === 'fatal') return styles.rowFatal;
    return undefined;
}

export function Table<T extends TableRowMeta>({
    columns,
    rows,
    sortKey,
    sortDirection,
    onSort,
    onRowClick,
    stickyHeader = true,
    loading = false,
    skeletonRows = 5,
    ariaLabel,
    className,
}: TableProps<T>) {

    return (
        <div className={cx(styles.wrap, className)}>
            <table aria-label={ariaLabel} className={styles.table}>
                <thead className={cx(stickyHeader && styles.sticky)}>
                    <tr>
                        {columns.map((col) => {
                            const isSorted = col.key === sortKey;
                            return (
                                <th
                                    key={col.key}
                                    style={col.width ? { width: typeof col.width === 'number' ? `${col.width}px` : col.width } : undefined}
                                    className={cx(
                                        alignClass(col.align),
                                        isSorted && styles.sorted,
                                    )}
                                    aria-sort={isSorted ? (sortDirection === 'asc' ? 'ascending' : 'descending') : undefined}
                                >
                                    {col.sortable && onSort ? (
                                        <button
                                            type="button"
                                            className={styles.sortBtn}
                                            onClick={() => onSort(col.key)}
                                        >
                                            {col.header}
                                            <SortIcon direction={isSorted ? sortDirection ?? null : null} />
                                        </button>
                                    ) : (
                                        col.header
                                    )}
                                </th>
                            );
                        })}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row) => (
                        <tr
                            key={row.id}
                            className={cx(
                                variantClass(row.variant),
                                row.selected && styles.selected,
                                onRowClick && styles.clickable,
                            )}
                            onClick={onRowClick ? () => onRowClick(row) : undefined}
                        >
                            {columns.map((col) => (
                                <td
                                    key={col.key}
                                    className={cx(
                                        alignClass(col.align),
                                        col.numeric && styles.numeric,
                                        col.dim && styles.dim,
                                    )}
                                >
                                    {col.render(row)}
                                </td>
                            ))}
                        </tr>
                    ))}
                    {loading
                        ? Array.from({ length: skeletonRows }).map((_, i) => (
                              <tr key={`skel-${i}`} className={styles.skeletonRow}>
                                  {columns.map((col) => (
                                      <td key={col.key}>
                                          <Skeleton height={10} width="80%" radius={3} />
                                      </td>
                                  ))}
                              </tr>
                          ))
                        : null}
                </tbody>
            </table>
        </div>
    );
}

function SortIcon({ direction }: { direction: SortDirection }) {
    if (direction === 'asc') {
        return (
            <svg className={styles.sortIcon} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <path d="M7 9l5-5 5 5" />
            </svg>
        );
    }
    if (direction === 'desc') {
        return (
            <svg className={styles.sortIcon} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <path d="M7 15l5 5 5-5" />
            </svg>
        );
    }
    return (
        <svg className={cx(styles.sortIcon, styles.sortIconUnsorted)} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M7 15l5 5 5-5" />
            <path d="M7 9l5-5 5 5" opacity="0.5" />
        </svg>
    );
}
