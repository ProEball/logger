'use client';

import { cx } from '@/shared/utils/cx';
import { Popover } from '@/shared/components/Popover/Popover';
import type { OrgMember } from '@/features/organizations/services/organizations.service';
import styles from './MemberRow.module.scss';

export type MemberActionType = 'change-role' | 'remove' | 'transfer';

type RoleDotVariant = 'purple' | 'cyan' | 'orange' | 'green' | 'muted';

const AVATAR_GRADIENTS = [
    'linear-gradient(135deg, #ff79c6 0%, #bd93f9 100%)',
    'linear-gradient(135deg, #50fa7b 0%, #8be9fd 100%)',
    'linear-gradient(135deg, #ffb86c 0%, #ff79c6 100%)',
    'linear-gradient(135deg, #8be9fd 0%, #bd93f9 100%)',
    'linear-gradient(135deg, #bd93f9 0%, #50fa7b 100%)',
    'linear-gradient(135deg, #f1fa8c 0%, #ffb86c 100%)',
];

const ROLE_DOT_VARIANTS: RoleDotVariant[] = ['purple', 'cyan', 'orange', 'green', 'muted'];

const roleDotClassMap: Record<RoleDotVariant, string> = {
    purple: styles.roleDotPurple,
    cyan: styles.roleDotCyan,
    orange: styles.roleDotOrange,
    green: styles.roleDotGreen,
    muted: styles.roleDotMuted,
};

function getAvatarGradient(userId: string): string {
    return AVATAR_GRADIENTS[userId.charCodeAt(0) % AVATAR_GRADIENTS.length];
}

function getInitials(name: string): string {
    return name
        .split(' ')
        .map(n => n[0] ?? '')
        .join('')
        .toUpperCase()
        .slice(0, 2);
}

function getRoleDotVariant(roleName: string): RoleDotVariant {
    const lower = roleName.toLowerCase();
    if (lower.includes('admin') || lower.includes('owner')) return 'purple';
    if (lower.includes('dev') || lower.includes('eng')) return 'cyan';
    if (lower.includes('view') || lower.includes('read')) return 'muted';
    return ROLE_DOT_VARIANTS[roleName.charCodeAt(0) % ROLE_DOT_VARIANTS.length];
}

interface MemberRowProps {
    member: OrgMember;
    currentUserId: string;
    actorCanChangeRole: boolean;
    actorCanRemove: boolean;
    isActorOwner: boolean;
    onAction: (type: MemberActionType) => void;
}

export function MemberRow({
    member,
    currentUserId,
    actorCanChangeRole,
    actorCanRemove,
    isActorOwner,
    onAction,
}: MemberRowProps) {
    const showChangeRole = actorCanChangeRole && !member.isOwner;
    const showRemove = actorCanRemove && !member.isOwner;
    const showTransfer = isActorOwner && !member.isOwner;
    const showMenu = showChangeRole || showRemove || showTransfer;
    const isCurrentUser = member.userId === currentUserId;
    const roleDotVariant = getRoleDotVariant(member.roleName);

    return (
        <tr>
            <td>
                <div className={styles.nameCell}>
                    <span
                        className={styles.avatar}
                        style={{ background: getAvatarGradient(member.userId) }}
                        aria-hidden="true"
                    >
                        {getInitials(member.name)}
                    </span>
                    <span className={styles.name}>{member.name}</span>
                    {member.isOwner ? (
                        <span className={styles.ownerBadge}>
                            <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                <path d="M12 2l3 6.5L22 9l-5 5 1.5 7L12 17.5 5.5 21 7 14 2 9l7-.5L12 2z" />
                            </svg>
                            Owner
                        </span>
                    ) : null}
                    {isCurrentUser ? <span className={styles.youTag}>you</span> : null}
                </div>
            </td>
            <td className={styles.mono}>{member.email}</td>
            <td>
                <span className={styles.role}>
                    <span
                        className={cx(styles.roleDot, roleDotClassMap[roleDotVariant])}
                        aria-hidden="true"
                    />
                    {member.roleName}
                </span>
            </td>
            <td className={styles.mono}>{member.joinedAt.toLocaleDateString()}</td>
            <td className={styles.actionsCell}>
                {showMenu ? (
                    <Popover
                        placement="bottom-end"
                        width={180}
                        trigger={
                            <button type="button" className={styles.kebab} aria-label="Member actions">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                    <circle cx="12" cy="5" r="1" />
                                    <circle cx="12" cy="12" r="1" />
                                    <circle cx="12" cy="19" r="1" />
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
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                                    </svg>
                                    Change role
                                </button>
                            ) : null}
                            {showTransfer ? (
                                <button
                                    type="button"
                                    className={styles.menuItem}
                                    onClick={() => onAction('transfer')}
                                >
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                        <path d="M16 16l4-4-4-4" />
                                        <path d="M4 12h16" />
                                        <path d="M4 20V4" />
                                    </svg>
                                    Transfer ownership
                                </button>
                            ) : null}
                            {showRemove ? (
                                <>
                                    {(showChangeRole || showTransfer) ? <span className={styles.menuSep} /> : null}
                                    <button
                                        type="button"
                                        className={cx(styles.menuItem, styles.menuItemDanger)}
                                        onClick={() => onAction('remove')}
                                    >
                                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                            <polyline points="3 6 5 6 21 6" />
                                            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                                            <path d="M10 11v6M14 11v6" />
                                            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                        </svg>
                                        Remove member
                                    </button>
                                </>
                            ) : null}
                        </div>
                    </Popover>
                ) : null}
            </td>
        </tr>
    );
}
