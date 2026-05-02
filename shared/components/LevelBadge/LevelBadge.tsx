import { cx } from '@/shared/utils/cx';
import styles from './LevelBadge.module.scss';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';
export type LevelBadgeSize = 'sm' | 'md';

export interface LevelBadgeProps {
    level: LogLevel;
    size?: LevelBadgeSize;
    className?: string;
}

export function LevelBadge({ level, size = 'sm', className }: LevelBadgeProps) {
    return (
        <span
            className={cx(styles.badge, styles[level], styles[size], className)}
            aria-label={`Level: ${level}`}
        >
            <span className={styles.dot} />
            {level}
        </span>
    );
}
