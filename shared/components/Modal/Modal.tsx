'use client';

import { useEffect, useRef, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useIsHydrated } from '@/shared/hooks/use-is-hydrated';
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
    // Track programmatic closes so the native close event doesn't call onClose.
    // When open→false we call dialog.close() ourselves; the resulting close event
    // must be ignored, otherwise callers whose onClose resets state would
    // overwrite any concurrent state transitions (e.g. "invite" → "created").
    const isProgrammaticClose = useRef(false);
    // createPortal needs a DOM target, which does not exist during SSR.
    const mounted = useIsHydrated();

    useEffect(() => {
        const node = dialogRef.current;
        if (!node) return;
        if (open && !node.open) {
            node.showModal();
        } else if (!open && node.open) {
            isProgrammaticClose.current = true;
            node.close();
        }
    }, [open]);

    const handleNativeClose = () => {
        if (isProgrammaticClose.current) {
            isProgrammaticClose.current = false;
            return;
        }
        onClose();
    };

    const handleBackdropClick = (event: MouseEvent<HTMLDialogElement>) => {
        if (!closeOnBackdropClick) return;
        if (event.target === dialogRef.current) onClose();
    };

    if (!mounted) return null;

    return createPortal(
        <dialog
            ref={dialogRef}
            className={cx(styles.dialog, styles[size], className)}
            onClose={handleNativeClose}
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
        </dialog>,
        document.body,
    );
}
