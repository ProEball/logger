import { useId, type ReactElement, type ReactNode } from 'react';
import { cx } from '@/shared/utils/cx';
import styles from './FormField.module.scss';

export interface FormFieldProps {
    label?: ReactNode;
    helper?: ReactNode;
    error?: ReactNode;
    htmlFor?: string;
    required?: boolean;
    className?: string;
    children: ReactElement;
}

// Visual wrapper around a form control. Composes label + control + helper/error.
// Does not own state — control is provided by the consumer (Input, Select, etc.).
export function FormField({
    label,
    helper,
    error,
    htmlFor,
    required = false,
    className,
    children,
}: FormFieldProps) {
    const generatedId = useId();
    const id = htmlFor ?? generatedId;
    const messageId = error || helper ? `${id}-message` : undefined;

    return (
        <div className={cx(styles.field, className)}>
            {label !== undefined ? (
                <label htmlFor={id} className={styles.label}>
                    {label}
                    {required ? <span aria-hidden="true" className={styles.required}>*</span> : null}
                </label>
            ) : null}
            {children}
            {error ? (
                <span id={messageId} className={styles.error} role="alert">
                    {error}
                </span>
            ) : helper ? (
                <span id={messageId} className={styles.helper}>
                    {helper}
                </span>
            ) : null}
        </div>
    );
}
