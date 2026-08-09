"use client";

import { useEffect, useState, useTransition } from "react";
import { Button, FormField, Input, Modal } from "@/shared/components";
import { useToast } from "@/shared/components/Toast/ToastProvider";
import { updateApiKeyRateLimitAction } from "@/features/api-keys/actions/update-api-key-rate-limit.action";
import styles from "./ApiKeyRateLimitDialog.module.scss";

interface ApiKeyRateLimitDialogProps {
    open: boolean;
    onClose: () => void;
    keyId: string;
    keyName: string;
    currentRateLimitPerMin: number;
    orgSlug: string;
    projectSlug: string;
}

export function ApiKeyRateLimitDialog({
    open,
    onClose,
    keyId,
    keyName,
    currentRateLimitPerMin,
    orgSlug,
    projectSlug,
}: ApiKeyRateLimitDialogProps) {
    const toast = useToast();
    const [isPending, startTransition] = useTransition();
    const [rateLimitPerMin, setRateLimitPerMin] = useState(String(currentRateLimitPerMin));
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (open) {
            setRateLimitPerMin(String(currentRateLimitPerMin));
            setError(null);
        }
    }, [open, currentRateLimitPerMin]);

    const rateLimitValue = Number(rateLimitPerMin);
    const isRateLimitValid = Number.isInteger(rateLimitValue) && rateLimitValue >= 1 && rateLimitValue <= 100_000;

    const handleClose = () => {
        if (isPending) return;
        setError(null);
        onClose();
    };

    const handleSave = (e: React.FormEvent) => {
        e.preventDefault();
        if (!isRateLimitValid) return;
        setError(null);
        startTransition(async () => {
            const result = await updateApiKeyRateLimitAction({
                orgSlug,
                projectSlug,
                keyId,
                rateLimitPerMin: rateLimitValue,
            });
            if ("error" in result) {
                setError(result.error);
                return;
            }
            toast.push({
                variant: "success",
                title: "Rate limit updated",
                body: `"${keyName}" is now limited to ${rateLimitValue} events/min.`,
            });
            onClose();
        });
    };

    return (
        <Modal open={open} onClose={handleClose} title="Edit rate limit" size="sm">
            <form onSubmit={handleSave} noValidate>
                <div className={styles.body}>
                    <p className={styles.text}>
                        Set how many events <strong>{keyName}</strong> can ingest per minute.
                    </p>
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
                            autoFocus
                        />
                    </FormField>
                    {error ? <p className={styles.error} role="alert">{error}</p> : null}
                </div>
                <div className={styles.footer}>
                    <Button type="button" variant="ghost" onClick={handleClose} disabled={isPending}>
                        Cancel
                    </Button>
                    <Button type="submit" variant="primary" disabled={isPending || !isRateLimitValid}>
                        {isPending ? "Saving…" : "Save"}
                    </Button>
                </div>
            </form>
        </Modal>
    );
}
