"use client";

import { useState, useTransition } from "react";
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

const DEFAULT_RATE_LIMIT = 1000;

export function ApiKeyCreateDialog({ open, onClose, orgSlug, projectSlug }: ApiKeyCreateDialogProps) {
    const [isPending, startTransition] = useTransition();
    const [name, setName] = useState("");
    const [rateLimitPerMin, setRateLimitPerMin] = useState(String(DEFAULT_RATE_LIMIT));
    const [error, setError] = useState<string | null>(null);
    const [createdKey, setCreatedKey] = useState<string | null>(null);

    const rateLimitValue = Number(rateLimitPerMin);
    const isRateLimitValid = Number.isInteger(rateLimitValue) && rateLimitValue >= 1 && rateLimitValue <= 100_000;

    const handleClose = () => {
        if (isPending) return;
        setName("");
        setRateLimitPerMin(String(DEFAULT_RATE_LIMIT));
        setError(null);
        onClose();
    };

    const handleCreate = (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim() || !isRateLimitValid) return;
        setError(null);
        startTransition(async () => {
            const result = await createApiKeyAction({
                orgSlug,
                projectSlug,
                name: name.trim(),
                rateLimitPerMin: rateLimitValue,
            });
            if ("error" in result) {
                setError(result.error);
                return;
            }
            setCreatedKey(result.plainKey);
        });
    };

    // See InviteMemberDialog — reset during render, not from an effect.
    const [wasOpen, setWasOpen] = useState(open);
    if (wasOpen !== open) {
        setWasOpen(open);
        if (!open) {
            setCreatedKey(null);
            setName("");
            setRateLimitPerMin(String(DEFAULT_RATE_LIMIT));
            setError(null);
        }
    }

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
                        <FormField
                            label="Rate limit"
                            required
                            helper="Maximum events per minute this key can ingest."
                            error={!isRateLimitValid ? "Enter a number between 1 and 100,000." : undefined}
                        >
                            <Input
                                type="number"
                                min={1}
                                max={100_000}
                                value={rateLimitPerMin}
                                onChange={(e) => { setRateLimitPerMin(e.target.value); setError(null); }}
                                disabled={isPending}
                                suffix="/ min"
                                invalid={!isRateLimitValid}
                            />
                        </FormField>
                        {error ? <p className={styles.error} role="alert">{error}</p> : null}
                    </div>
                    <div className={styles.footer}>
                        <Button type="button" variant="ghost" onClick={handleClose} disabled={isPending}>
                            Cancel
                        </Button>
                        <Button type="submit" variant="primary" disabled={isPending || !name.trim() || !isRateLimitValid}>
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
