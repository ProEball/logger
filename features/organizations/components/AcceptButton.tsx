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
            <Button type="button" variant="primary" disabled={isPending} onClick={handleClick}>
                {isPending ? "Accepting…" : "Accept invitation"}
            </Button>
        </div>
    );
}
