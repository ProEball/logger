'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/shared/components/Button/Button';
import { FormField } from '@/shared/components/FormField/FormField';
import { Input } from '@/shared/components/Input/Input';
import { useToast } from '@/shared/components/Toast/ToastProvider';
import { changePasswordAction } from '@/features/auth/actions/change-password.action';
import styles from './ChangePasswordForm.module.scss';

export function ChangePasswordForm() {
    const toast = useToast();
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [isPending, startTransition] = useTransition();

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
            const result = await changePasswordAction({
                currentPassword,
                newPassword,
                confirmPassword,
            });
            if (result.error) {
                setError(result.error);
                return;
            }
            toast.push({ variant: 'success', title: 'Password changed', body: 'Other sessions have been signed out.' });
            setCurrentPassword('');
            setNewPassword('');
            setConfirmPassword('');
        });
    };

    return (
        <form className={styles.form} onSubmit={handleSubmit} noValidate>
            <FormField label="Current password" required>
                <Input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    autoComplete="current-password"
                    disabled={isPending}
                    required
                />
            </FormField>

            <FormField label="New password" required>
                <Input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    autoComplete="new-password"
                    disabled={isPending}
                    required
                />
            </FormField>

            <FormField label="Confirm new password" required>
                <Input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    autoComplete="new-password"
                    disabled={isPending}
                    required
                />
            </FormField>

            {error ? <p className={styles.error} role="alert">{error}</p> : null}

            <div className={styles.actions}>
                <Button variant="primary" type="submit" disabled={isPending}>
                    {isPending ? 'Changing…' : 'Change password'}
                </Button>
            </div>
        </form>
    );
}
