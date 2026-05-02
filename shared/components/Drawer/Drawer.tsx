'use client';

import { useEffect, useRef, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { cx } from '@/shared/utils/cx';
import styles from './Drawer.module.scss';

export type DrawerSide = 'right' | 'left';

export interface DrawerProps {
    open: boolean;
    onClose: () => void;
    title?: ReactNode;
    footer?: ReactNode;
    side?: DrawerSide;
    width?: number | string;
    closeOnBackdropClick?: boolean;
    children?: ReactNode;
    className?: string;
    ariaLabel?: string;
}

export function Drawer({
    open,
    onClose,
    title,
    footer,
    side = 'right',
    width = 520,
    closeOnBackdropClick = true,
    children,
    className,
    ariaLabel,
}: DrawerProps) {
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

    const widthValue = typeof width === 'number' ? `${width}px` : width;
    const sideClass = side === 'left' ? styles.left : styles.right;

    return (
        <dialog
            ref={dialogRef}
            aria-label={ariaLabel}
            className={cx(styles.dialog, sideClass, className)}
            style={{ '--drawer-width': widthValue } as CSSProperties}
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
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
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
