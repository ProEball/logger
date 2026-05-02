'use client';

import { useEffect, useRef, type MouseEvent, type ReactNode } from 'react';
import { cx } from '@/shared/utils/cx';
import styles from './Modal.module.scss';

export type ModalSize = 'sm' | 'md' | 'lg';

export interface ModalProps {
    open: boolean;
    onClose: () => void;
    title?: ReactNode;
    footer?: ReactNode;
    size?: ModalSize;
    closeOnBackdropClick?: boolean;
    children?: ReactNode;
    className?: string;
}

export function Modal({
    open,
    onClose,
    title,
    footer,
    size = 'md',
    closeOnBackdropClick = true,
    children,
    className,
}: ModalProps) {
    const dialogRef = useRef<HTMLDialogElement>(null);

    useEffect(() => {
        const node = dialogRef.current;
        if (!node) {
            return;
        }
        if (open && !node.open) {
            node.showModal();
        } else if (!open && node.open) {
            node.close();
        }
    }, [open]);

    const handleBackdropClick = (event: MouseEvent<HTMLDialogElement>) => {
        if (!closeOnBackdropClick) {
            return;
        }
        if (event.target === dialogRef.current) {
            onClose();
        }
    };

    return (
        <dialog
            ref={dialogRef}
            className={cx(styles.dialog, styles[size], className)}
            onClose={onClose}
            onClick={handleBackdropClick}
        >
            <div className={styles.surface}>
                {title !== undefined ? (
                    <header className={styles.header}>
                        <h2 className={styles.title}>{title}</h2>
                        <button
                            type="button"
                            aria-label="Close"
                            className={styles.close}
                            onClick={onClose}
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                <line x1="18" y1="6" x2="6" y2="18" />
                                <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                        </button>
                    </header>
                ) : null}
                <div className={styles.body}>{children}</div>
                {footer !== undefined ? (
                    <footer className={styles.footer}>{footer}</footer>
                ) : null}
            </div>
        </dialog>
    );
}
