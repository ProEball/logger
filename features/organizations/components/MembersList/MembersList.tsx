'use client';

import { useId, useState, useTransition } from 'react';
import { Button } from '@/shared/components/Button/Button';
import { ConfirmDialog } from '@/shared/components/ConfirmDialog/ConfirmDialog';
import { Modal } from '@/shared/components/Modal/Modal';
import { changeMemberRoleAction } from '@/features/organizations/actions/change-member-role.action';
import { removeMemberAction } from '@/features/organizations/actions/remove-member.action';
import { transferOwnershipAction } from '@/features/organizations/actions/transfer-ownership.action';
import type { OrgMember } from '@/features/organizations/services/organizations.service';
import { MemberRow, type MemberActionType } from '../MemberRow/MemberRow';
import styles from './MembersList.module.scss';

type Role = { id: string; name: string };
type DialogType = 'none' | 'change-role' | 'remove' | 'transfer';

interface MembersListProps {
    members: OrgMember[];
    roles: Role[];
    orgSlug: string;
    actorCanChangeRole: boolean;
    actorCanRemove: boolean;
    isActorOwner: boolean;
}

export function MembersList({
    members,
    roles,
    orgSlug,
    actorCanChangeRole,
    actorCanRemove,
    isActorOwner,
}: MembersListProps) {
    const roleSelectId = useId();
    const [dialog, setDialog] = useState<DialogType>('none');
    const [activeMemberId, setActiveMemberId] = useState<string | null>(null);
    const [selectedRoleId, setSelectedRoleId] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [isPending, startTransition] = useTransition();

    const activeMember = members.find((m) => m.userId === activeMemberId) ?? null;

    const closeDialog = () => {
        if (isPending) return;
        setDialog('none');
        setActiveMemberId(null);
        setError(null);
    };

    const openDialog = (memberId: string, type: MemberActionType) => {
        const m = members.find((mem) => mem.userId === memberId);
        setActiveMemberId(memberId);
        setSelectedRoleId(m?.roleId ?? '');
        setError(null);
        setDialog(type);
    };

    const handleChangeRole = () => {
        if (!activeMemberId) return;
        setError(null);
        startTransition(async () => {
            const result = await changeMemberRoleAction({
                orgSlug,
                targetUserId: activeMemberId,
                newRoleId: selectedRoleId,
            });
            if (result?.error) { setError(result.error); return; }
            setDialog('none');
            setActiveMemberId(null);
        });
    };

    const handleRemove = () => {
        if (!activeMemberId) return;
        setError(null);
        startTransition(async () => {
            const result = await removeMemberAction({ orgSlug, targetUserId: activeMemberId });
            if (result?.error) { setError(result.error); return; }
            setDialog('none');
            setActiveMemberId(null);
        });
    };

    const handleTransfer = () => {
        if (!activeMemberId) return;
        setError(null);
        startTransition(async () => {
            const result = await transferOwnershipAction({ orgSlug, targetUserId: activeMemberId });
            if (result?.error) { setError(result.error); return; }
            setDialog('none');
            setActiveMemberId(null);
        });
    };

    return (
        <section className={styles.section}>
            <h2 className={styles.heading}>Members ({members.length})</h2>
            <div className={styles.tableWrap}>
                <table className={styles.table}>
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Email</th>
                            <th>Role</th>
                            <th>Joined</th>
                            <th />
                        </tr>
                    </thead>
                    <tbody>
                        {members.map((m) => (
                            <MemberRow
                                key={m.userId}
                                member={m}
                                actorCanChangeRole={actorCanChangeRole}
                                actorCanRemove={actorCanRemove}
                                isActorOwner={isActorOwner}
                                onAction={(type) => openDialog(m.userId, type)}
                            />
                        ))}
                    </tbody>
                </table>
            </div>

            <Modal
                open={dialog === 'change-role'}
                onClose={closeDialog}
                title={activeMember ? `Change role — ${activeMember.name}` : 'Change role'}
                size="sm"
                closeOnBackdropClick={!isPending}
                footer={
                    <div className={styles.dialogFooter}>
                        <Button variant="ghost" onClick={closeDialog} disabled={isPending}>
                            Cancel
                        </Button>
                        <Button variant="primary" onClick={handleChangeRole} disabled={isPending}>
                            {isPending ? 'Saving…' : 'Save'}
                        </Button>
                    </div>
                }
            >
                <div className={styles.roleSelectWrap}>
                    <label htmlFor={roleSelectId} className={styles.label}>Role</label>
                    <select
                        id={roleSelectId}
                        value={selectedRoleId}
                        onChange={(e) => setSelectedRoleId(e.target.value)}
                        className={styles.select}
                        disabled={isPending}
                    >
                        {roles.map((r) => (
                            <option key={r.id} value={r.id}>{r.name}</option>
                        ))}
                    </select>
                    {error ? <p className={styles.fieldError} role="alert">{error}</p> : null}
                </div>
            </Modal>

            <ConfirmDialog
                open={dialog === 'remove'}
                onClose={closeDialog}
                title="Remove member"
                message={
                    activeMember
                        ? `Remove ${activeMember.name} (${activeMember.email}) from this organization? They will lose access immediately.`
                        : ''
                }
                confirmLabel="Remove"
                destructive
                isPending={isPending}
                error={error}
                onConfirm={handleRemove}
            />

            <ConfirmDialog
                open={dialog === 'transfer'}
                onClose={closeDialog}
                title="Transfer ownership"
                message={
                    activeMember
                        ? `Transfer ownership to ${activeMember.name}? You will remain a member but lose owner privileges.`
                        : ''
                }
                confirmLabel="Transfer"
                isPending={isPending}
                error={error}
                onConfirm={handleTransfer}
            />
        </section>
    );
}
