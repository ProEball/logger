import { cx } from '@/shared/utils/cx';
import styles from './Avatar.module.scss';

export interface AvatarProps {
    name?: string;
    size?: number;
    className?: string;
}

function initialsFrom(name: string | undefined): string {
    if (!name) {
        return '?';
    }
    return name
        .split(/\s+/)
        .map((part) => part[0])
        .filter(Boolean)
        .join('')
        .slice(0, 2)
        .toUpperCase();
}

export function Avatar({ name, size = 24, className }: AvatarProps) {
    const initials = initialsFrom(name);

    return (
        <div
            className={cx(styles.avatar, className)}
            style={{
                width: size,
                height: size,
                fontSize: Math.round(size * 0.38),
            }}
            aria-label={name ?? 'Unknown user'}
        >
            {initials}
        </div>
    );
}
