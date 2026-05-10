'use client';

import { useTransition } from 'react';
import { Button } from '@/shared/components/Button/Button';
import { useToast } from '@/shared/components/Toast/ToastProvider';
import { revokeInvitationAction } from '@/features/organizations/actions/revoke-invitation.action';
import type { PendingInvitation } from '@/features/organizations/services/organizations.service';
import styles from './InvitationsList.module.scss';

interface InvitationsListProps {
    invitations: PendingInvitation[];
    orgSlug: string;
}

export function InvitationsList({ invitations, orgSlug }: InvitationsListProps) {
    const toast = useToast();
    const [isPending, startTransition] = useTransition();

    if (invitations.length === 0) return null;

    const handleRevoke = (invitationId: string) => {
        startTransition(async () => {
            const result = await revokeInvitationAction(invitationId, orgSlug);
            if (result.error) {
                toast.push({ variant: 'danger', title: 'Failed to revoke', body: result.error });
            }
        });
    };

    return (
        <section className={styles.section}>
            <h2 className={styles.heading}>Pending invitations ({invitations.length})</h2>
            <div className={styles.tableWrap}>
                <table className={styles.table}>
                    <thead>
                        <tr>
                            <th>Email</th>
                            <th>Role</th>
                            <th>Expires</th>
                            <th />
                        </tr>
                    </thead>
                    <tbody>
                        {invitations.map((inv) => (
                            <tr key={inv.id}>
                                <td>{inv.email}</td>
                                <td className={styles.muted}>{inv.roleName}</td>
                                <td className={styles.muted}>
                                    {inv.expiresAt.toLocaleDateString()}
                                </td>
                                <td className={styles.actions}>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        disabled={isPending}
                                        onClick={() => handleRevoke(inv.id)}
                                    >
                                        Revoke
                                    </Button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </section>
    );
}
