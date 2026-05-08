'use client';

import { useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/shared/components/Button/Button';
import { ConfirmDialog } from '@/shared/components/ConfirmDialog/ConfirmDialog';
import { transferOwnershipAction } from '@/features/organizations/actions/transfer-ownership.action';
import type { OrgMember } from '@/features/organizations/services/organizations.service';
import styles from './TransferOwnershipForm.module.scss';

interface TransferOwnershipFormProps {
    orgSlug: string;
    members: OrgMember[];
}

export function TransferOwnershipForm({ orgSlug, members }: TransferOwnershipFormProps) {
    const selectId = useId();
    const router = useRouter();
    const [isPending, startTransition] = useTransition();

    const candidates = members.filter((m) => !m.isOwner);
    const [selectedUserId, setSelectedUserId] = useState(candidates[0]?.userId ?? '');
    const [showConfirm, setShowConfirm] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const selectedMember = candidates.find((m) => m.userId === selectedUserId) ?? null;

    const handleConfirm = () => {
        setError(null);
        startTransition(async () => {
            const result = await transferOwnershipAction({
                orgSlug,
                targetUserId: selectedUserId,
            });
            if (result.error) {
                setError(result.error);
                setShowConfirm(false);
                return;
            }
            router.push(`/${orgSlug}/team`);
        });
    };

    if (candidates.length === 0) {
        return (
            <p className={styles.empty}>
                There are no other members to transfer ownership to.
            </p>
        );
    }

    return (
        <>
            <div className={styles.form}>
                <div className={styles.selectWrap}>
                    <label htmlFor={selectId} className={styles.label}>
                        Transfer to
                    </label>
                    <select
                        id={selectId}
                        value={selectedUserId}
                        onChange={(e) => setSelectedUserId(e.target.value)}
                        className={styles.select}
                        disabled={isPending}
                    >
                        {candidates.map((m) => (
                            <option key={m.userId} value={m.userId}>
                                {m.name} ({m.email})
                            </option>
                        ))}
                    </select>
                </div>

                {error ? <p className={styles.error} role="alert">{error}</p> : null}

                <Button
                    variant="secondary"
                    onClick={() => setShowConfirm(true)}
                    disabled={isPending || !selectedUserId}
                >
                    Transfer ownership
                </Button>
            </div>

            <ConfirmDialog
                open={showConfirm}
                onClose={() => { if (!isPending) setShowConfirm(false); }}
                title="Transfer ownership"
                message={
                    selectedMember
                        ? `Transfer ownership to ${selectedMember.name} (${selectedMember.email})? You will remain a member but lose owner privileges.`
                        : ''
                }
                confirmLabel="Transfer"
                isPending={isPending}
                error={null}
                onConfirm={handleConfirm}
            />
        </>
    );
}
