'use client';

import { Button } from '@/shared/components/Button/Button';
import { Modal } from '@/shared/components/Modal/Modal';
import styles from './ConfirmDialog.module.scss';

export interface ConfirmDialogProps {
    open: boolean;
    onClose: () => void;
    title: string;
    message: string;
    confirmLabel?: string;
    destructive?: boolean;
    isPending?: boolean;
    error?: string | null;
    onConfirm: () => void;
}

export function ConfirmDialog({
    open,
    onClose,
    title,
    message,
    confirmLabel = 'Confirm',
    destructive = false,
    isPending = false,
    error,
    onConfirm,
}: ConfirmDialogProps) {
    return (
        <Modal
            open={open}
            onClose={onClose}
            title={title}
            size="sm"
            closeOnBackdropClick={!isPending}
            footer={
                <div className={styles.footer}>
                    <Button variant="ghost" onClick={onClose} disabled={isPending}>
                        Cancel
                    </Button>
                    <Button
                        variant={destructive ? 'danger' : 'primary'}
                        onClick={onConfirm}
                        disabled={isPending}
                    >
                        {isPending ? 'Working…' : confirmLabel}
                    </Button>
                </div>
            }
        >
            <p className={styles.message}>{message}</p>
            {error ? (
                <p className={styles.error} role="alert">
                    {error}
                </p>
            ) : null}
        </Modal>
    );
}
