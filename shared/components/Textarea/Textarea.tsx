import type { TextareaHTMLAttributes } from 'react';
import { cx } from '@/shared/utils/cx';
import styles from './Textarea.module.scss';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
    invalid?: boolean;
}

export function Textarea({
    invalid = false,
    className,
    rows = 4,
    ...rest
}: TextareaProps) {
    return (
        <textarea
            rows={rows}
            className={cx(
                styles.textarea,
                invalid && styles.invalid,
                className,
            )}
            {...rest}
        />
    );
}
