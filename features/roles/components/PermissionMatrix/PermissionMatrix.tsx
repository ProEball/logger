'use client';

import { Checkbox } from '@/shared/components/Checkbox/Checkbox';
import { OWNER_ONLY_PERMISSIONS, PERMISSIONS } from '@/shared/permissions/registry';
import type { Permission } from '@/shared/permissions/registry';
import {
    PERMISSION_GROUP_ORDER,
    PERMISSION_GROUPS,
} from '@/shared/permissions/groups';
import styles from './PermissionMatrix.module.scss';

interface PermissionMatrixProps {
    value: Permission[];
    onChange: (perms: Permission[]) => void;
    disabled?: boolean;
}

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

    return (
        <div className={styles.matrix}>
            {PERMISSION_GROUP_ORDER.map((groupKey) => {
                const group = PERMISSION_GROUPS[groupKey];
                const visible = group.permissions.filter(
                    (p) => !OWNER_ONLY_PERMISSIONS.has(p),
                );
                if (visible.length === 0) return null;

                return (
                    <div key={groupKey} className={styles.group}>
                        <p className={styles.groupLabel}>{group.label}</p>
                        <div className={styles.checkboxes}>
                            {visible.map((perm) => (
                                <Checkbox
                                    key={perm}
                                    label={PERMISSIONS[perm]}
                                    checked={selected.has(perm)}
                                    onChange={() => toggle(perm)}
                                    disabled={disabled}
                                />
                            ))}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
