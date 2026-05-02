import type { ReactNode } from 'react';
import { cx } from '@/shared/utils/cx';
import styles from './KeyValue.module.scss';

export type KeyValueVariant = 'default' | 'string' | 'number' | 'url';

export interface KeyValueRowItem {
    key: string;
    value: ReactNode;
    variant?: KeyValueVariant;
}

export interface KeyValueProps {
    rows: KeyValueRowItem[];
    keyWidth?: number | string;
    className?: string;
}

export function KeyValue({ rows, keyWidth = 140, className }: KeyValueProps) {
    return (
        <div
            className={cx(styles.list, className)}
            style={{ '--kv-key-width': typeof keyWidth === 'number' ? `${keyWidth}px` : keyWidth } as React.CSSProperties}
        >
            {rows.map((row) => (
                <div key={row.key} className={styles.row}>
                    <span className={styles.key}>{row.key}</span>
                    <span className={cx(styles.value, row.variant && styles[row.variant])}>
                        {row.value}
                    </span>
                </div>
            ))}
        </div>
    );
}
