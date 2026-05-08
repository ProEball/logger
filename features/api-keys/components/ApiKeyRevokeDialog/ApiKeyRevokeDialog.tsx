"use client";

import { useTransition, useState } from "react";
import { Button, Modal } from "@/shared/components";
import { revokeApiKeyAction } from "@/features/api-keys/actions/revoke-api-key.action";
import styles from "./ApiKeyRevokeDialog.module.scss";

interface ApiKeyRevokeDialogProps {
    open: boolean;
    onClose: () => void;
    keyId: string;
    keyName: string;
    keyPrefix: string;
    orgSlug: string;
    projectSlug: string;
}

export function ApiKeyRevokeDialog({
    open,
    onClose,
    keyId,
    keyName,
    keyPrefix,
    orgSlug,
    projectSlug,
}: ApiKeyRevokeDialogProps) {
    const [isPending, startTransition] = useTransition();
    const [error, setError] = useState<string | null>(null);

    const handleClose = () => {
        if (isPending) return;
        setError(null);
        onClose();
    };

    const handleRevoke = () => {
        setError(null);
        startTransition(async () => {
            const result = await revokeApiKeyAction({ orgSlug, projectSlug, keyId });
            if ("error" in result) {
                setError(result.error);
                return;
            }
            onClose();
        });
    };

    return (
        <Modal open={open} onClose={handleClose} title="Revoke API key" size="sm">
            <div className={styles.body}>
                <p className={styles.text}>
                    This will immediately revoke <strong>{keyName}</strong>{" "}
                    (<code className={styles.code}>lgr_{keyPrefix}…</code>).
                    Any services using this key will lose access immediately.
                </p>
                {error ? <p className={styles.error} role="alert">{error}</p> : null}
            </div>
            <div className={styles.footer}>
                <Button variant="ghost" onClick={handleClose} disabled={isPending}>
                    Cancel
                </Button>
                <Button variant="danger" onClick={handleRevoke} disabled={isPending}>
                    {isPending ? "Revoking…" : "Revoke key"}
                </Button>
            </div>
        </Modal>
    );
}
