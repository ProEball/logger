'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/shared/components/Button/Button';
import { FormField } from '@/shared/components/FormField/FormField';
import { Input } from '@/shared/components/Input/Input';
import { Textarea } from '@/shared/components/Textarea/Textarea';
import { createRoleAction } from '@/features/roles/actions/create-role.action';
import { updateRoleAction } from '@/features/roles/actions/update-role.action';
import type { OrgRole } from '@/features/roles/services/roles.service';
import type { Permission } from '@/shared/permissions/registry';
import { ASSIGNABLE_PERMISSIONS } from '@/features/roles/utils/assignable-permissions';
import { PermissionMatrix } from '../PermissionMatrix/PermissionMatrix';
import styles from './RoleEditor.module.scss';

interface RoleEditorProps {
    orgSlug: string;
    role?: OrgRole;
}

export function RoleEditor({ orgSlug, role }: RoleEditorProps) {
    const isNew = !role;
    const router = useRouter();
    const [isPending, startTransition] = useTransition();

    const [name, setName] = useState(role?.name ?? '');
    const [description, setDescription] = useState(role?.description ?? '');
    const [permissions, setPermissions] = useState<Permission[]>(
        (role?.permissions ?? []) as Permission[],
    );
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
            const result = isNew
                ? await createRoleAction({ orgSlug, name, description: description || undefined, permissions })
                : await updateRoleAction({ orgSlug, roleId: role.id, name, description: description || undefined, permissions });

            if (result.error) {
                setError(result.error);
                return;
            }
            router.push(`/${orgSlug}/settings/roles`);
        });
    };

    const isSystemRole = role?.isSystem ?? false;

    return (
        <form className={styles.form} onSubmit={handleSubmit} noValidate>
            <div className={styles.head}>
                <h1 className={styles.title}>{role ? role.name : 'New role'}</h1>
                <span className={styles.sub}>
                    {permissions.length} of {ASSIGNABLE_PERMISSIONS.length} permissions
                </span>
                <div className={styles.spacer} />
                <Button
                    variant="ghost"
                    type="button"
                    onClick={() => router.push(`/${orgSlug}/settings/roles`)}
                    disabled={isPending}
                >
                    Back to roles
                </Button>
            </div>

            <div className={styles.fields}>
                <FormField label="Name" required>
                    <Input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="e.g. QA Engineer"
                        disabled={isPending || isSystemRole}
                        required
                    />
                </FormField>

                {isSystemRole ? (
                    <p className={styles.systemNote}>
                        System roles cannot be renamed.
                    </p>
                ) : null}

                <FormField label="Description">
                    <Textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Briefly describe what this role can do"
                        rows={2}
                        disabled={isPending}
                    />
                </FormField>

                <PermissionMatrix
                    value={permissions}
                    onChange={setPermissions}
                    disabled={isPending}
                />
            </div>

            {error ? <p className={styles.error} role="alert">{error}</p> : null}

            <div className={styles.actions}>
                <span className={styles.note}>
                    {permissions.length} {permissions.length === 1 ? 'permission' : 'permissions'} selected
                </span>
                <Button
                    variant="secondary"
                    type="button"
                    onClick={() => router.push(`/${orgSlug}/settings/roles`)}
                    disabled={isPending}
                >
                    Cancel
                </Button>
                <Button variant="primary" type="submit" disabled={isPending}>
                    {isPending ? 'Saving…' : isNew ? 'Create role' : 'Save changes'}
                </Button>
            </div>
        </form>
    );
}
