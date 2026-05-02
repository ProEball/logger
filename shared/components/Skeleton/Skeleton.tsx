import type { CSSProperties } from 'react';
import { cx } from '@/shared/utils/cx';
import styles from './Skeleton.module.scss';

export interface SkeletonProps {
    width?: number | string;
    height?: number | string;
    radius?: number | string;
    className?: string;
}

export function Skeleton({
    width = '100%',
    height = 12,
    radius = 3,
    className,
}: SkeletonProps) {
    const style: CSSProperties = {
        width,
        height,
        borderRadius: radius,
    };

    return (
        <span
            aria-hidden="true"
            className={cx(styles.skeleton, className)}
            style={style}
        />
    );
}
