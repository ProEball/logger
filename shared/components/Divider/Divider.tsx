import { cx } from '@/shared/utils/cx';
import styles from './Divider.module.scss';

export interface DividerProps {
    orientation?: 'horizontal' | 'vertical';
    className?: string;
}

export function Divider({ orientation = 'horizontal', className }: DividerProps) {
    return (
        <div
            role="separator"
            aria-orientation={orientation}
            className={cx(styles.divider, styles[orientation], className)}
        />
    );
}
