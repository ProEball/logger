"use client";
import { useState } from "react";
import { Button, Modal } from "@/shared/components";
import styles from "./InvitationCreatedDialog.module.scss";

interface InvitationCreatedDialogProps {
    open: boolean;
    onClose: () => void;
    inviteUrl: string;
}

export function InvitationCreatedDialog({ open, onClose, inviteUrl }: InvitationCreatedDialogProps) {
    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(inviteUrl);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // Clipboard unavailable — user can copy manually
        }
    };

    return (
        <Modal
            open={open}
            onClose={onClose}
            title="Invitation created"
            closeOnBackdropClick={false}
            size="md"
            footer={
                <Button variant="primary" onClick={onClose}>
                    Done
                </Button>
            }
        >
            <div className={styles.body}>
                <p className={styles.hint}>
                    Share this link with the person you&apos;re inviting. It expires in 7 days.
                </p>
                <div className={styles.urlRow}>
                    <code className={styles.url}>{inviteUrl}</code>
                    <Button variant="secondary" size="sm" onClick={handleCopy}>
                        {copied ? "Copied!" : "Copy link"}
                    </Button>
                </div>
            </div>
        </Modal>
    );
}
