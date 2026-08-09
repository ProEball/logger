"use client";

import { useTransition, useState } from "react";
import { Button, Modal } from "@/shared/components";
import { useToast } from "@/shared/components/Toast/ToastProvider";
import { deleteApiKeyAction } from "@/features/api-keys/actions/delete-api-key.action";
import styles from "./ApiKeyDeleteDialog.module.scss";

interface ApiKeyDeleteDialogProps {
    open: boolean;
    onClose: () => void;
    keyId: string;
    keyName: string;
    keyPrefix: string;
    orgSlug: string;
    projectSlug: string;
}

export function ApiKeyDeleteDialog({
    open,
    onClose,
    keyId,
    keyName,
    keyPrefix,
    orgSlug,
    projectSlug,
}: ApiKeyDeleteDialogProps) {
    const toast = useToast();
    const [isPending, startTransition] = useTransition();
    const [error, setError] = useState<string | null>(null);

    const handleClose = () => {
        if (isPending) return;
        setError(null);
        onClose();
    };

    const handleDelete = () => {
        setError(null);
        startTransition(async () => {
            const result = await deleteApiKeyAction({ orgSlug, projectSlug, keyId });
            if ("error" in result) {
                setError(result.error);
                return;
            }
            toast.push({ variant: 'success', title: 'API key deleted', body: `"${keyName}" has been permanently deleted.` });
            onClose();
        });
    };

    return (
        <Modal open={open} onClose={handleClose} title="Delete API key" size="sm">
            <div className={styles.body}>
                <p className={styles.text}>
                    This will permanently delete <strong>{keyName}</strong>{" "}
                    (<code className={styles.code}>lgr_{keyPrefix}…</code>).
                    This cannot be undone — the key and its history will no longer appear in this list.
                </p>
                {error ? <p className={styles.error} role="alert">{error}</p> : null}
            </div>
            <div className={styles.footer}>
                <Button variant="ghost" onClick={handleClose} disabled={isPending}>
                    Cancel
                </Button>
                <Button variant="danger" onClick={handleDelete} disabled={isPending}>
                    {isPending ? "Deleting…" : "Delete permanently"}
                </Button>
            </div>
        </Modal>
    );
}
