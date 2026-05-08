"use client";

import { useState } from "react";
import { Button } from "@/shared/components";
import { ApiKeyCreateDialog } from "../ApiKeyCreateDialog/ApiKeyCreateDialog";
import styles from "./ApiKeysPageHeader.module.scss";

interface ApiKeysPageHeaderProps {
    orgSlug: string;
    projectSlug: string;
    canManage: boolean;
}

export function ApiKeysPageHeader({ orgSlug, projectSlug, canManage }: ApiKeysPageHeaderProps) {
    const [showCreate, setShowCreate] = useState(false);

    return (
        <>
            <div className={styles.header}>
                <h1 className={styles.title}>API keys</h1>
                {canManage && (
                    <Button variant="primary" size="sm" onClick={() => setShowCreate(true)}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                        Create API key
                    </Button>
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
