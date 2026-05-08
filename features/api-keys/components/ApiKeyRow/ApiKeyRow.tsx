"use client";

import { useState } from "react";
import { Button, StatusBadge } from "@/shared/components";
import { ApiKeyRevokeDialog } from "../ApiKeyRevokeDialog/ApiKeyRevokeDialog";
import type { ApiKey } from "@/features/api-keys/services/api-keys.service";
import styles from "./ApiKeyRow.module.scss";

interface ApiKeyRowProps {
    apiKey: ApiKey;
    orgSlug: string;
    projectSlug: string;
    canManage: boolean;
}

export function ApiKeyRow({ apiKey, orgSlug, projectSlug, canManage }: ApiKeyRowProps) {
    const [showRevoke, setShowRevoke] = useState(false);

    const isRevoked = apiKey.revokedAt !== null;
    const maskedKey = `lgr_${apiKey.keyPrefix}…`;
    const lastUsed = apiKey.lastUsedAt ? formatRelative(new Date(apiKey.lastUsedAt)) : "Never";

    return (
        <>
            <tr className={isRevoked ? styles.revoked : undefined}>
                <td className={styles.name}>{apiKey.name}</td>
                <td className={styles.key}>
                    <span title="Full key cannot be retrieved." className={styles.keyMono}>
                        {maskedKey}
                    </span>
                </td>
                <td className={styles.lastUsed}>{lastUsed}</td>
                <td className={styles.status}>
                    <StatusBadge
                        status={isRevoked ? "danger" : "success"}
                        label={isRevoked ? "revoked" : "active"}
                    />
                </td>
                <td className={styles.actions}>
                    {!isRevoked && canManage && (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setShowRevoke(true)}
                            className={styles.revokeBtn}
                        >
                            Revoke
                        </Button>
                    )}
                </td>
            </tr>

            <ApiKeyRevokeDialog
                open={showRevoke}
                onClose={() => setShowRevoke(false)}
                keyId={apiKey.id}
                keyName={apiKey.name}
                keyPrefix={apiKey.keyPrefix}
                orgSlug={orgSlug}
                projectSlug={projectSlug}
            />
        </>
    );
}

function formatRelative(date: Date): string {
    const diff = Date.now() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}
