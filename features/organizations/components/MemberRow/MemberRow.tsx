'use client';

import { cx } from '@/shared/utils/cx';
import { Popover } from '@/shared/components/Popover/Popover';
import type { OrgMember } from '@/features/organizations/services/organizations.service';
import styles from './MemberRow.module.scss';

export type MemberActionType = 'change-role' | 'remove' | 'transfer';

interface MemberRowProps {
    member: OrgMember;
    actorCanChangeRole: boolean;
    actorCanRemove: boolean;
    isActorOwner: boolean;
    onAction: (type: MemberActionType) => void;
}

export function MemberRow({
    member,
    actorCanChangeRole,
    actorCanRemove,
    isActorOwner,
    onAction,
}: MemberRowProps) {
    const showChangeRole = actorCanChangeRole && !member.isOwner;
    const showRemove = actorCanRemove && !member.isOwner;
    const showTransfer = isActorOwner && !member.isOwner;
    const showMenu = showChangeRole || showRemove || showTransfer;

    return (
        <tr>
            <td>
                <span className={styles.name}>{member.name}</span>
                {member.isOwner ? <span className={styles.ownerBadge}>Owner</span> : null}
            </td>
            <td className={styles.muted}>{member.email}</td>
            <td>{member.roleName}</td>
            <td className={styles.muted}>{member.joinedAt.toLocaleDateString()}</td>
            <td className={styles.actionsCell}>
                {showMenu ? (
                    <Popover
                        placement="bottom-end"
                        width={180}
                        trigger={
                            <button type="button" className={styles.kebab} aria-label="Member actions">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                    <circle cx="12" cy="5" r="2" />
                                    <circle cx="12" cy="12" r="2" />
                                    <circle cx="12" cy="19" r="2" />
                                </svg>
                            </button>
                        }
                    >
                        <div className={styles.menu}>
                            {showChangeRole ? (
                                <button
                                    type="button"
                                    className={styles.menuItem}
                                    onClick={() => onAction('change-role')}
                                >
                                    Change role
                                </button>
                            ) : null}
                            {showTransfer ? (
                                <button
                                    type="button"
                                    className={styles.menuItem}
                                    onClick={() => onAction('transfer')}
                                >
                                    Transfer ownership
                                </button>
                            ) : null}
                            {showRemove ? (
                                <button
                                    type="button"
                                    className={cx(styles.menuItem, styles.menuItemDanger)}
                                    onClick={() => onAction('remove')}
                                >
                                    Remove member
                                </button>
                            ) : null}
                        </div>
                    </Popover>
                ) : null}
            </td>
        </tr>
    );
}
