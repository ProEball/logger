'use client';

import { Checkbox } from '@/shared/components/Checkbox/Checkbox';
import { PERMISSIONS } from '@/shared/permissions/registry';
import type { Permission } from '@/shared/permissions/registry';
import { ASSIGNABLE_PERMISSIONS, ASSIGNABLE_PERMISSION_GROUPS } from '@/features/roles/utils/assignable-permissions';
import styles from './PermissionMatrix.module.scss';

interface PermissionMatrixProps {
    value: Permission[];
    onChange: (perms: Permission[]) => void;
    disabled?: boolean;
}

// Permissions that remove, delete, or revoke something irreversibly — called
// out visually so a role author notices before granting them.
const DESTRUCTIVE_PERMISSIONS: ReadonlySet<Permission> = new Set([
    'members.remove',
    'projects.delete',
    'events.delete',
    'api_keys.manage',
]);

export function PermissionMatrix({ value, onChange, disabled = false }: PermissionMatrixProps) {
    const selected = new Set(value);

    const toggle = (perm: Permission) => {
        if (disabled) return;
        const next = new Set(selected);
        if (next.has(perm)) {
            next.delete(perm);
        } else {
            next.add(perm);
        }
        onChange(Array.from(next) as Permission[]);
    };

    const setMany = (perms: readonly Permission[], on: boolean) => {
        if (disabled) return;
        const next = new Set(selected);
        for (const perm of perms) {
            if (on) {
                next.add(perm);
            } else {
                next.delete(perm);
            }
        }
        onChange(Array.from(next) as Permission[]);
    };

    return (
        <div className={styles.panel}>
            <div className={styles.panelHead}>
                <span className={styles.panelTitle}>Permissions</span>
                <span className={styles.panelCount}>
                    {selected.size} / {ASSIGNABLE_PERMISSIONS.length} selected
                </span>
                <div className={styles.spacer} />
                <button
                    type="button"
                    className={styles.linkBtn}
                    onClick={() => setMany(ASSIGNABLE_PERMISSIONS, true)}
                    disabled={disabled}
                >
                    Select all
                </button>
                <button
                    type="button"
                    className={styles.linkBtn}
                    onClick={() => setMany(ASSIGNABLE_PERMISSIONS, false)}
                    disabled={disabled}
                >
                    Clear all
                </button>
            </div>

            {ASSIGNABLE_PERMISSION_GROUPS.map((group) => {
                const groupSelectedCount = group.permissions.filter((p) => selected.has(p)).length;
                return (
                    <div key={group.key} className={styles.group}>
                        <div className={styles.groupHead}>
                            <span className={styles.groupLabel}>{group.label}</span>
                            <span className={styles.groupCount}>
                                {groupSelectedCount}/{group.permissions.length}
                            </span>
                            <div className={styles.spacer} />
                            <button
                                type="button"
                                className={styles.linkBtn}
                                onClick={() => setMany(group.permissions, true)}
                                disabled={disabled}
                            >
                                Select all
                            </button>
                            <button
                                type="button"
                                className={styles.linkBtn}
                                onClick={() => setMany(group.permissions, false)}
                                disabled={disabled}
                            >
                                Clear
                            </button>
                        </div>
                        <div className={styles.list}>
                            {group.permissions.map((perm) => (
                                <div key={perm} className={styles.item}>
                                    <Checkbox
                                        wrapperClassName={styles.itemControl}
                                        checked={selected.has(perm)}
                                        onChange={() => toggle(perm)}
                                        disabled={disabled}
                                        label={
                                            <span className={styles.itemText}>
                                                <b>
                                                    {PERMISSIONS[perm]}
                                                    {DESTRUCTIVE_PERMISSIONS.has(perm) ? (
                                                        <span className={styles.destructiveTag}>destructive</span>
                                                    ) : null}
                                                </b>
                                                <code>{perm}</code>
                                            </span>
                                        }
                                    />
                                </div>
                            ))}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
