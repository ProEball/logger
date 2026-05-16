'use client';

import { useTransition } from 'react';
import { useToast } from '@/shared/components/Toast/ToastProvider';
import { revokeInvitationAction } from '@/features/organizations/actions/revoke-invitation.action';
import type { PendingInvitation } from '@/features/organizations/services/organizations.service';
import styles from './InvitationsList.module.scss';

interface InvitationsListProps {
    invitations: PendingInvitation[];
    orgSlug: string;
}

const EnvelopeIcon = () => (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
        <polyline points="22,6 12,13 2,6" />
    </svg>
);

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
            <div className={styles.sectionHead}>
                <h3 className={styles.heading}>Pending invitations</h3>
                <span className={styles.count}>({invitations.length})</span>
            </div>
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
                                <td>
                                    <div className={styles.emailCell}>
                                        <span className={styles.emailAvatar}>
                                            <EnvelopeIcon />
                                        </span>
                                        <span className={styles.mono}>{inv.email}</span>
                                    </div>
                                </td>
                                <td className={styles.muted}>{inv.roleName}</td>
                                <td className={styles.mono}>
                                    {inv.expiresAt.toLocaleDateString()}
                                </td>
                                <td className={styles.actions}>
                                    <button
                                        type="button"
                                        className={styles.revokeBtn}
                                        disabled={isPending}
                                        onClick={() => handleRevoke(inv.id)}
                                    >
                                        Revoke
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </section>
    );
}
