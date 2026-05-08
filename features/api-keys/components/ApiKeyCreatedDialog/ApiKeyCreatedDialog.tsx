"use client";

import { useState } from "react";
import { Button, Checkbox, Modal } from "@/shared/components";
import styles from "./ApiKeyCreatedDialog.module.scss";

interface ApiKeyCreatedDialogProps {
    open: boolean;
    onClose: () => void;
    plainKey: string;
}

export function ApiKeyCreatedDialog({ open, onClose, plainKey }: ApiKeyCreatedDialogProps) {
    const [copied, setCopied] = useState(false);
    const [confirmed, setConfirmed] = useState(false);

    const handleCopy = async () => {
        await navigator.clipboard.writeText(plainKey);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleClose = () => {
        if (!confirmed) return;
        setConfirmed(false);
        setCopied(false);
        onClose();
    };

    return (
        <Modal open={open} onClose={() => {}} title="Your new API key" size="md">
            <div className={styles.body}>
                <div className={styles.keyBlock}>
                    <code className={styles.keyValue}>{plainKey}</code>
                    <button
                        type="button"
                        className={styles.copyBtn}
                        onClick={handleCopy}
                        aria-label="Copy API key"
                    >
                        {copied ? (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <polyline points="20 6 9 17 4 12" />
                            </svg>
                        ) : (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                            </svg>
                        )}
                    </button>
                </div>
                <p className={styles.warning}>
                    This key will not be shown again. Copy it now and store it securely.
                </p>

                <Checkbox
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                    label="I've saved this key in a secure location."
                />
            </div>

            <div className={styles.footer}>
                <Button variant="primary" onClick={handleClose} disabled={!confirmed}>
                    Close
                </Button>
            </div>
        </Modal>
    );
}
