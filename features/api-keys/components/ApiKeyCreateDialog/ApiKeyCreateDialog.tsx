"use client";

import { useState, useTransition, useEffect } from "react";
import { Button, FormField, Input, Modal } from "@/shared/components";
import { createApiKeyAction } from "@/features/api-keys/actions/create-api-key.action";
import { ApiKeyCreatedDialog } from "../ApiKeyCreatedDialog/ApiKeyCreatedDialog";
import styles from "./ApiKeyCreateDialog.module.scss";

interface ApiKeyCreateDialogProps {
    open: boolean;
    onClose: () => void;
    orgSlug: string;
    projectSlug: string;
}

export function ApiKeyCreateDialog({ open, onClose, orgSlug, projectSlug }: ApiKeyCreateDialogProps) {
    const [isPending, startTransition] = useTransition();
    const [name, setName] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [createdKey, setCreatedKey] = useState<string | null>(null);

    const handleClose = () => {
        if (isPending) return;
        setName("");
        setError(null);
        onClose();
    };

    const handleCreate = (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim()) return;
        setError(null);
        startTransition(async () => {
            const result = await createApiKeyAction({ orgSlug, projectSlug, name: name.trim() });
            if ("error" in result) {
                setError(result.error);
                return;
            }
            setCreatedKey(result.plainKey);
        });
    };

    useEffect(() => {
        if (!open) {
            setCreatedKey(null);
            setName("");
            setError(null);
        }
    }, [open]);

    const handleRevealClose = () => {
        setCreatedKey(null);
        setName("");
        onClose();
    };

    return (
        <>
            <Modal open={open && !createdKey} onClose={handleClose} title="Create API key" size="sm">
                <form onSubmit={handleCreate} noValidate>
                    <div className={styles.body}>
                        <FormField
                            label="Key name"
                            required
                            helper="A label to identify this key in the list."
                        >
                            <Input
                                value={name}
                                onChange={(e) => { setName(e.target.value); setError(null); }}
                                placeholder="Production server"
                                disabled={isPending}
                                maxLength={80}
                                autoFocus
                            />
                        </FormField>
                        {error ? <p className={styles.error} role="alert">{error}</p> : null}
                    </div>
                    <div className={styles.footer}>
                        <Button type="button" variant="ghost" onClick={handleClose} disabled={isPending}>
                            Cancel
                        </Button>
                        <Button type="submit" variant="primary" disabled={isPending || !name.trim()}>
                            {isPending ? "Creating…" : "Create"}
                        </Button>
                    </div>
                </form>
            </Modal>

            <ApiKeyCreatedDialog
                open={Boolean(createdKey)}
                onClose={handleRevealClose}
                plainKey={createdKey ?? ""}
            />
        </>
    );
}
