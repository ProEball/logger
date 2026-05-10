'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/shared/components/Button/Button';
import { FormField } from '@/shared/components/FormField/FormField';
import { Input } from '@/shared/components/Input/Input';
import { useToast } from '@/shared/components/Toast/ToastProvider';
import { updateAccountAction } from '@/features/auth/actions/update-account.action';
import styles from './AccountProfileForm.module.scss';

interface AccountProfileFormProps {
    initialName: string;
    email: string;
}

export function AccountProfileForm({ initialName, email }: AccountProfileFormProps) {
    const toast = useToast();
    const [name, setName] = useState(initialName);
    const [error, setError] = useState<string | null>(null);
    const [isPending, startTransition] = useTransition();

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
            const result = await updateAccountAction({ name });
            if (result.error) {
                setError(result.error);
                return;
            }
            toast.push({ variant: 'success', title: 'Profile saved' });
        });
    };

    return (
        <form className={styles.form} onSubmit={handleSubmit} noValidate>
            <FormField label="Email">
                <Input value={email} disabled />
            </FormField>

            <FormField label="Display name" required>
                <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your name"
                    disabled={isPending}
                    required
                />
            </FormField>

            {error ? <p className={styles.error} role="alert">{error}</p> : null}

            <div className={styles.actions}>
                <Button variant="primary" type="submit" disabled={isPending}>
                    {isPending ? 'Saving…' : 'Save changes'}
                </Button>
            </div>
        </form>
    );
}
