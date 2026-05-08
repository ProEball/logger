'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/shared/components/Button/Button';
import { FormField } from '@/shared/components/FormField/FormField';
import { Input } from '@/shared/components/Input/Input';
import { deleteOrgAction } from '@/features/organizations/actions/delete-org.action';
import styles from './DeleteOrgForm.module.scss';

interface DeleteOrgFormProps {
    orgSlug: string;
    orgName: string;
}

export function DeleteOrgForm({ orgSlug, orgName }: DeleteOrgFormProps) {
    const [confirmName, setConfirmName] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [isPending, startTransition] = useTransition();

    const isMatch = confirmName === orgName;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
            const result = await deleteOrgAction({ orgSlug, confirmName });
            if (result?.error) {
                setError(result.error);
            }
            // On success the action calls redirect('/') — no client-side handling needed.
        });
    };

    return (
        <form className={styles.form} onSubmit={handleSubmit} noValidate>
            <p className={styles.warning}>
                This will permanently delete <strong>{orgName}</strong> and all its data —
                projects, events, alerts, API keys, roles, and members. This cannot be undone.
            </p>

            <FormField
                label={
                    <>
                        Type <strong>{orgName}</strong> to confirm
                    </>
                }
                required
            >
                <Input
                    value={confirmName}
                    onChange={(e) => setConfirmName(e.target.value)}
                    placeholder={orgName}
                    disabled={isPending}
                    required
                />
            </FormField>

            {error ? <p className={styles.error} role="alert">{error}</p> : null}

            <Button variant="danger" type="submit" disabled={isPending || !isMatch}>
                {isPending ? 'Deleting…' : 'Delete organization'}
            </Button>
        </form>
    );
}
