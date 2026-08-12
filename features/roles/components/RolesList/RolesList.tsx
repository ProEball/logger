'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/shared/components/Button/Button';
import { ConfirmDialog } from '@/shared/components/ConfirmDialog/ConfirmDialog';
import { deleteRoleAction } from '@/features/roles/actions/delete-role.action';
import type { OrgRole } from '@/features/roles/services/roles.service';
import { ASSIGNABLE_PERMISSIONS } from '@/features/roles/utils/assignable-permissions';
import styles from './RolesList.module.scss';

interface RolesListProps {
    roles: OrgRole[];
    orgSlug: string;
}

function IconLock() {
    return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="10" width="16" height="11" rx="2" />
            <path d="M8 10V7a4 4 0 0 1 8 0v3" />
        </svg>
    );
}

function IconStar() {
    return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2l2.4 6.5H21l-5.3 3.9 2 6.6-5.7-4.1-5.7 4.1 2-6.6L3 8.5h6.6z" />
        </svg>
    );
}

export function RolesList({ roles, orgSlug }: RolesListProps) {
    const router = useRouter();
    const [confirmRoleId, setConfirmRoleId] = useState<string | null>(null);
    const [deleteError, setDeleteError] = useState<string | null>(null);
    const [isPending, startTransition] = useTransition();

    const activeRole = roles.find((r) => r.id === confirmRoleId) ?? null;
    const total = ASSIGNABLE_PERMISSIONS.length;

    const openConfirm = (roleId: string) => {
        setConfirmRoleId(roleId);
        setDeleteError(null);
    };

    const closeConfirm = () => {
        if (isPending) return;
        setConfirmRoleId(null);
        setDeleteError(null);
    };

    const handleDelete = () => {
        if (!confirmRoleId) return;
        setDeleteError(null);
        startTransition(async () => {
            const result = await deleteRoleAction({ orgSlug, roleId: confirmRoleId });
            if (result.error) {
                setDeleteError(result.error);
                return;
            }
            setConfirmRoleId(null);
            router.refresh();
        });
    };

    return (
        <section className={styles.section}>
            <div className={styles.tableWrap}>
                <table className={styles.table}>
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Description</th>
                            <th>Permissions</th>
                            <th />
                        </tr>
                    </thead>
                    <tbody>
                        {roles.map((role) => {
                            const percent = total === 0 ? 0 : Math.round((role.permissions.length / total) * 100);
                            return (
                                <tr key={role.id}>
                                    <td>
                                        <div className={styles.roleName}>
                                            <span className={styles.roleIcon}>
                                                {role.isSystem ? <IconLock /> : <IconStar />}
                                            </span>
                                            <span className={styles.nm}>{role.name}</span>
                                            <span className={role.isSystem ? styles.systemBadge : styles.customBadge}>
                                                {role.isSystem ? 'System' : 'Custom'}
                                            </span>
                                            {role.isDefault ? (
                                                <span className={styles.defaultBadge}>Default</span>
                                            ) : null}
                                        </div>
                                    </td>
                                    <td className={styles.descCell}>
                                        {role.description ?? '—'}
                                    </td>
                                    <td>
                                        <div className={styles.permCell}>
                                            <span className={styles.permCount}>
                                                {role.permissions.length}/{total}
                                            </span>
                                            <span className={styles.permMeter}>
                                                <span style={{ width: `${percent}%` }} />
                                            </span>
                                        </div>
                                    </td>
                                    <td className={styles.actionsCell}>
                                        <Link
                                            href={`/${orgSlug}/settings/roles/${role.id}`}
                                            className={styles.editLink}
                                        >
                                            Edit
                                        </Link>
                                        {!role.isSystem ? (
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => openConfirm(role.id)}
                                            >
                                                Delete
                                            </Button>
                                        ) : null}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            <div className={styles.hint}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 16v-4M12 8h.01" />
                </svg>
                <span>
                    Full access, including organization deletion, always belongs to the{' '}
                    <b className={styles.hintStrong}>organization owner</b> — a single member,
                    transferred from Settings → Danger zone, not managed through roles.
                </span>
            </div>

            <ConfirmDialog
                open={confirmRoleId !== null}
                onClose={closeConfirm}
                title="Delete role"
                message={
                    activeRole
                        ? `Delete the "${activeRole.name}" role? This cannot be undone.`
                        : ''
                }
                confirmLabel="Delete"
                destructive
                isPending={isPending}
                error={deleteError}
                onConfirm={handleDelete}
            />
        </section>
    );
}
