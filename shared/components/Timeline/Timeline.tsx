import type { ReactNode } from 'react';
import { cx } from '@/shared/utils/cx';
import type { LogLevel } from '@/shared/components/LevelBadge/LevelBadge';
import styles from './Timeline.module.scss';

export interface TimelineItem {
    id: string;
    level?: LogLevel;
    time: string;
    title: string;
    description?: string;
}

export interface TimelineProps {
    items: TimelineItem[];
    className?: string;
    children?: ReactNode;
}

export function Timeline({ items, className }: TimelineProps) {
    return (
        <ol className={cx(styles.root, className)}>
            {items.map((item) => (
                <li key={item.id} className={styles.item}>
                    <span
                        className={cx(styles.dot, item.level && styles[`dot_${item.level}`])}
                        aria-hidden="true"
                    />
                    <div className={styles.body}>
                        <span className={styles.time}>{item.time}</span>
                        <span className={styles.title}>{item.title}</span>
                        {item.description ? (
                            <span className={styles.description}>{item.description}</span>
                        ) : null}
                    </div>
                </li>
            ))}
        </ol>
    );
}
