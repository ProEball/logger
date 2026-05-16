import { cx } from '@/shared/utils/cx';
import styles from './CountPill.module.scss';

export interface CountPillProps {
    count: number | string;
    live?: boolean;
    className?: string;
}

export function CountPill({ count, live, className }: CountPillProps) {
    return (
        <span className={cx(styles.pill, live && styles.live, className)}>
            {count}
        </span>
    );
}
