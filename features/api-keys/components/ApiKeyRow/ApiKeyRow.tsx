"use client";

import { useState } from "react";
import { ApiKeyRevokeDialog } from "../ApiKeyRevokeDialog/ApiKeyRevokeDialog";
import { ApiKeyRateLimitDialog } from "../ApiKeyRateLimitDialog/ApiKeyRateLimitDialog";
import { ApiKeyDeleteDialog } from "../ApiKeyDeleteDialog/ApiKeyDeleteDialog";
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
    const [showRateLimit, setShowRateLimit] = useState(false);
    const [showDelete, setShowDelete] = useState(false);

    const isRevoked = apiKey.revokedAt !== null;
    const maskedKey = `lgr_${apiKey.keyPrefix}…`;
    const lastUsed = apiKey.lastUsedAt ? formatRelative(new Date(apiKey.lastUsedAt)) : "Never";

    return (
        <>
            <tr className={isRevoked ? `${styles.row} ${styles.revoked}` : styles.row}>
                <td className={styles.colName}>
                    <div className={styles.nameCell}>
                        <span className={styles.statusDot} />
                        <span className={styles.name}>{apiKey.name}</span>
                    </div>
                </td>

                <td className={styles.colKey}>
                    <span title="Full key cannot be retrieved." className={styles.keyMono}>
                        {maskedKey}
                    </span>
                </td>

                <td className={styles.colRateLimit}>
                    <span className={styles.rateLimitCell}>
                        <span className={styles.rateLimitValue}>{apiKey.rateLimitPerMin}/min</span>
                        {!isRevoked && canManage ? (
                            <button
                                type="button"
                                className={styles.editRateLimitBtn}
                                onClick={() => setShowRateLimit(true)}
                                aria-label="Edit rate limit"
                                title="Edit rate limit"
                            >
                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <path d="M12 20h9" />
                                    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                                </svg>
                            </button>
                        ) : null}
                    </span>
                </td>

                <td className={styles.colLast}>
                    <span className={styles.lastUsed}>{lastUsed}</span>
                </td>

                <td className={styles.colAct}>
                    {isRevoked ? (
                        <span className={styles.revokedActions}>
                            <span className={styles.revokedLabel}>revoked</span>
                            {canManage ? (
                                <button
                                    type="button"
                                    className={styles.deleteBtn}
                                    onClick={() => setShowDelete(true)}
                                >
                                    Delete
                                </button>
                            ) : null}
                        </span>
                    ) : canManage ? (
                        <button
                            type="button"
                            className={styles.revokeBtn}
                            onClick={() => setShowRevoke(true)}
                        >
                            Revoke
                        </button>
                    ) : null}
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

            <ApiKeyRateLimitDialog
                open={showRateLimit}
                onClose={() => setShowRateLimit(false)}
                keyId={apiKey.id}
                keyName={apiKey.name}
                currentRateLimitPerMin={apiKey.rateLimitPerMin}
                orgSlug={orgSlug}
                projectSlug={projectSlug}
            />

            <ApiKeyDeleteDialog
                open={showDelete}
                onClose={() => setShowDelete(false)}
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
