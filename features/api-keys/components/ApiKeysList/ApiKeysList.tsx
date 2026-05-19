"use client";

import { useState } from "react";
import { Button } from "@/shared/components";
import { ApiKeyRow } from "../ApiKeyRow/ApiKeyRow";
import { ApiKeyCreateDialog } from "../ApiKeyCreateDialog/ApiKeyCreateDialog";
import type { ApiKey } from "@/features/api-keys/services/api-keys.service";
import styles from "./ApiKeysList.module.scss";

interface ApiKeysListProps {
    apiKeys: ApiKey[];
    orgSlug: string;
    projectSlug: string;
    canManage: boolean;
}

export function ApiKeysList({ apiKeys, orgSlug, projectSlug, canManage }: ApiKeysListProps) {
    const [showCreate, setShowCreate] = useState(false);

    return (
        <>
            <div className={styles.panel}>
                <div className={styles.panelHeader}>
                    <h3 className={styles.panelTitle}>Keys</h3>
                    {apiKeys.length > 0 && (
                        <span className={styles.count}>{apiKeys.length}</span>
                    )}
                    <div className={styles.spacer} />
                    {canManage && (
                        <Button variant="primary" size="sm" onClick={() => setShowCreate(true)}>
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                            </svg>
                            Create API key
                        </Button>
                    )}
                </div>

                {apiKeys.length === 0 ? (
                    <div className={styles.empty}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
                        </svg>
                        <p className={styles.emptyHeading}>No API keys</p>
                        <p className={styles.emptyBody}>
                            Create a key to start ingesting events into this project.
                        </p>
                    </div>
                ) : (
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th>Key</th>
                                <th>Last used</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {apiKeys.map((key) => (
                                <ApiKeyRow
                                    key={key.id}
                                    apiKey={key}
                                    orgSlug={orgSlug}
                                    projectSlug={projectSlug}
                                    canManage={canManage}
                                />
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            <ApiKeyCreateDialog
                open={showCreate}
                onClose={() => setShowCreate(false)}
                orgSlug={orgSlug}
                projectSlug={projectSlug}
            />
        </>
    );
}
