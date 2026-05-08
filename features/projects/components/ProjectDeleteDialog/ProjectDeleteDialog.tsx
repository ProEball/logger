"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Modal, FormField, Input } from "@/shared/components";
import { deleteProjectAction } from "@/features/projects/actions/delete-project.action";
import styles from "./ProjectDeleteDialog.module.scss";

interface ProjectDeleteDialogProps {
    open: boolean;
    onClose: () => void;
    orgSlug: string;
    projectSlug: string;
    projectName: string;
}

export function ProjectDeleteDialog({
    open,
    onClose,
    orgSlug,
    projectSlug,
    projectName,
}: ProjectDeleteDialogProps) {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();
    const [confirm, setConfirm] = useState("");
    const [error, setError] = useState<string | null>(null);

    const isConfirmed = confirm === projectSlug;

    const handleClose = () => {
        if (isPending) return;
        setConfirm("");
        setError(null);
        onClose();
    };

    const handleDelete = () => {
        setError(null);
        startTransition(async () => {
            const result = await deleteProjectAction({ orgSlug, projectSlug, confirmSlug: confirm });
            if ("error" in result) {
                setError(result.error);
                return;
            }
            router.push(`/${orgSlug}/projects`);
        });
    };

    return (
        <Modal open={open} onClose={handleClose} title="Delete project" size="sm">
            <div className={styles.body}>
                <p className={styles.warning}>
                    This will delete <strong>{projectName}</strong> and revoke all its API keys immediately.
                    Events already sent will be retained for 30 days.
                </p>
                <p className={styles.irreversible}>This action cannot be undone.</p>

                <FormField
                    label={
                        <>
                            Type <code className={styles.code}>{projectSlug}</code> to confirm
                        </>
                    }
                >
                    <Input
                        value={confirm}
                        onChange={(e) => { setConfirm(e.target.value); setError(null); }}
                        placeholder={projectSlug}
                        disabled={isPending}
                        autoComplete="off"
                        spellCheck={false}
                    />
                </FormField>

                {error ? <p className={styles.error} role="alert">{error}</p> : null}
            </div>

            <div className={styles.footer}>
                <Button variant="ghost" onClick={handleClose} disabled={isPending}>
                    Cancel
                </Button>
                <Button variant="danger" onClick={handleDelete} disabled={!isConfirmed || isPending}>
                    {isPending ? "Deleting…" : "Delete project"}
                </Button>
            </div>
        </Modal>
    );
}
