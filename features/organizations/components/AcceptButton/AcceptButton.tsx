"use client";
import { useState, useTransition } from "react";
import { Button } from "@/shared/components";
import styles from "./AcceptButton.module.scss";

interface AcceptButtonProps {
    action: () => Promise<{ error?: string } | void>;
}

export function AcceptButton({ action }: AcceptButtonProps) {
    const [isPending, startTransition] = useTransition();
    const [error, setError] = useState<string | null>(null);

    const handleClick = () => {
        setError(null);
        startTransition(async () => {
            const result = await action();
            if (result && "error" in result && result.error) setError(result.error);
        });
    };

    return (
        <div className={styles.root}>
            {error ? (
                <p className={styles.error} role="alert">
                    {error}
                </p>
            ) : null}
            <Button
                type="button"
                variant="primary"
                size="lg"
                disabled={isPending}
                onClick={handleClick}
                rightIcon={
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="5" y1="12" x2="19" y2="12" />
                        <polyline points="12 5 19 12 12 19" />
                    </svg>
                }
            >
                {isPending ? "Accepting…" : "Accept invitation"}
            </Button>
        </div>
    );
}
