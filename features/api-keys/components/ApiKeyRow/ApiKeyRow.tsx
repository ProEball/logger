"use client";

import { useState } from "react";
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
    const [copied, setCopied] = useState(false);

    const isRevoked = apiKey.revokedAt !== null;
    const maskedKey = `lgr_${apiKey.keyPrefix}…`;
    const lastUsed = apiKey.lastUsedAt ? formatRelative(new Date(apiKey.lastUsedAt)) : "Never";

    const handleCopy = async () => {
        await navigator.clipboard.writeText(maskedKey);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

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
                    <span className={styles.keyCell}>
                        <span title="Full key cannot be retrieved." className={styles.keyMono}>
                            {maskedKey}
                        </span>
                        <button
                            type="button"
                            className={styles.copyBtn}
                            onClick={handleCopy}
                            aria-label={copied ? "Copied!" : "Copy to clipboard"}
                            title={copied ? "Copied!" : "Copy to clipboard"}
                        >
                            {copied ? (
                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <polyline points="20 6 9 17 4 12" />
                                </svg>
                            ) : (
                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                </svg>
                            )}
                        </button>
                    </span>
                </td>

                <td className={styles.colLast}>
                    <span className={styles.lastUsed}>{lastUsed}</span>
                </td>

                <td className={styles.colAct}>
                    {isRevoked ? (
                        <span className={styles.revokedLabel}>revoked</span>
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
