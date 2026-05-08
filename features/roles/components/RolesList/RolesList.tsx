'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/shared/components/Button/Button';
import { ConfirmDialog } from '@/shared/components/ConfirmDialog/ConfirmDialog';
import { deleteRoleAction } from '@/features/roles/actions/delete-role.action';
import type { OrgRole } from '@/features/roles/services/roles.service';
import styles from './RolesList.module.scss';

interface RolesListProps {
    roles: OrgRole[];
    orgSlug: string;
}

export function RolesList({ roles, orgSlug }: RolesListProps) {
    const router = useRouter();
    const [confirmRoleId, setConfirmRoleId] = useState<string | null>(null);
    const [deleteError, setDeleteError] = useState<string | null>(null);
    const [isPending, startTransition] = useTransition();

    const activeRole = roles.find((r) => r.id === confirmRoleId) ?? null;

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
                        {roles.map((role) => (
                            <tr key={role.id}>
                                <td>
                                    <span className={styles.roleName}>{role.name}</span>
                                    {role.isSystem ? (
                                        <span className={styles.systemBadge}>System</span>
                                    ) : (
                                        <span className={styles.customBadge}>Custom</span>
                                    )}
                                    {role.isDefault ? (
                                        <span className={styles.defaultBadge}>Default</span>
                                    ) : null}
                                </td>
                                <td className={styles.muted}>
                                    {role.description ?? '—'}
                                </td>
                                <td className={styles.muted}>
                                    {role.permissions.length === 0
                                        ? 'None'
                                        : `${role.permissions.length} permission${role.permissions.length === 1 ? '' : 's'}`}
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
                        ))}
                    </tbody>
                </table>
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
