'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/shared/components/Button/Button';
import { ConfirmDialog } from '@/shared/components/ConfirmDialog/ConfirmDialog';
import { FormField } from '@/shared/components/FormField/FormField';
import { Input } from '@/shared/components/Input/Input';
import { useToast } from '@/shared/components/Toast/ToastProvider';
import { updateOrgAction } from '@/features/organizations/actions/update-org.action';
import styles from './OrgSettingsForm.module.scss';

interface OrgSettingsFormProps {
    orgSlug: string;
    orgName: string;
    isOwner: boolean;
}

export function OrgSettingsForm({ orgSlug, orgName, isOwner }: OrgSettingsFormProps) {
    const router = useRouter();
    const toast = useToast();
    const [isPending, startTransition] = useTransition();

    const [name, setName] = useState(orgName);
    const [slug, setSlug] = useState(orgSlug);
    const [error, setError] = useState<string | null>(null);
    const [showSlugConfirm, setShowSlugConfirm] = useState(false);

    const slugChanged = slug !== orgSlug;

    const submit = () => {
        setError(null);
        startTransition(async () => {
            const result = await updateOrgAction({ orgSlug, name, newSlug: slug });
            if (result.error) {
                setError(result.error);
                return;
            }
            if (result.newSlug) {
                router.replace(`/${result.newSlug}/settings`);
                return;
            }
            toast.push({ variant: 'success', title: 'Settings saved' });
        });
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (slugChanged) {
            setShowSlugConfirm(true);
        } else {
            submit();
        }
    };

    return (
        <>
            <form className={styles.form} onSubmit={handleSubmit} noValidate>
                <FormField label="Organization name" required>
                    <Input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Acme Inc."
                        disabled={isPending}
                        required
                    />
                </FormField>

                <FormField
                    label="Slug"
                    helper={
                        isOwner
                            ? 'Used in all URLs. Changing it will break existing links.'
                            : 'Only the owner can change the slug.'
                    }
                    required
                >
                    <Input
                        value={slug}
                        onChange={(e) => setSlug(e.target.value.toLowerCase())}
                        placeholder="acme-inc"
                        disabled={isPending || !isOwner}
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

            <ConfirmDialog
                open={showSlugConfirm}
                onClose={() => { if (!isPending) setShowSlugConfirm(false); }}
                title="Change organization slug?"
                message={`This will change the URL from "/${orgSlug}/…" to "/${slug}/…". All existing links will break. Are you sure?`}
                confirmLabel="Change slug"
                isPending={isPending}
                error={null}
                onConfirm={() => {
                    setShowSlugConfirm(false);
                    submit();
                }}
            />
        </>
    );
}
