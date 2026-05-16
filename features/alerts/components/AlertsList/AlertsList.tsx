"use client";
import { useState } from "react";
import Link from "next/link";
import { AlertRow } from "@/features/alerts/components/AlertRow/AlertRow";
import type { AlertRule } from "@/core/db/schema";
import styles from "./AlertsList.module.scss";

interface AlertsListProps {
    rules: AlertRule[];
    allRules: AlertRule[];
    orgSlug: string;
    projectSlug: string;
    canManage: boolean;
}

function BellIcon() {
    return (
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/>
            <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>
        </svg>
    );
}

function PlusIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M12 5v14M5 12h14"/>
        </svg>
    );
}

export function AlertsList({ rules, allRules, orgSlug, projectSlug, canManage }: AlertsListProps) {
    const [showDisabled, setShowDisabled] = useState(true);

    const disabledCount = allRules.filter((r) => !r.enabled).length;
    const displayed = showDisabled ? allRules : rules;
    const firingCount = rules.filter((r) => r.state === "firing").length;

    const newHref = `/${orgSlug}/${projectSlug}/alerts/new`;

    if (displayed.length === 0 && !showDisabled) {
        return (
            <>
                <div className={styles.pageHead}>
                    <div className={styles.headLeft}>
                        <h1 className={styles.title}>Alerts</h1>
                        <div className={styles.sub}>0 rules</div>
                    </div>
                </div>
                <div className={styles.empty}>
                    <div className={styles.emptyIcon}><BellIcon /></div>
                    <h3 className={styles.emptyTitle}>No alert rules</h3>
                    <p className={styles.emptyText}>Create a rule to get notified when something goes wrong.</p>
                    {canManage && (
                        <Link href={newHref} className={styles.newBtn}>
                            <PlusIcon />New alert
                        </Link>
                    )}
                </div>
            </>
        );
    }

    return (
        <>
            <div className={styles.pageHead}>
                <div className={styles.headLeft}>
                    <h1 className={styles.title}>Alerts</h1>
                    <div className={styles.sub}>
                        {allRules.length} rules
                        {firingCount > 0 && (
                            <> · <span className={styles.firing}>{firingCount} firing</span></>
                        )}
                        {disabledCount > 0 && (
                            <> ·{" "}
                                <button
                                    type="button"
                                    onClick={() => setShowDisabled((v) => !v)}
                                    style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit", padding: 0 }}
                                >
                                    {showDisabled ? `hide ${disabledCount} disabled` : `show ${disabledCount} disabled`}
                                </button>
                            </>
                        )}
                    </div>
                </div>
                <div className={styles.headSpacer} />
                {canManage && (
                    <Link href={newHref} className={styles.newBtn}>
                        <PlusIcon />New alert
                    </Link>
                )}
            </div>

            <div className={styles.tableWrap}>
                <table className={styles.table}>
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th style={{ width: 120 }}>State</th>
                            <th style={{ width: 160 }}>Last triggered</th>
                            <th style={{ width: 130 }}>Channels</th>
                            {canManage && <th style={{ width: 240 }}>Actions</th>}
                        </tr>
                    </thead>
                    <tbody>
                        {displayed.map((rule) => (
                            <AlertRow
                                key={rule.id}
                                rule={rule}
                                orgSlug={orgSlug}
                                projectSlug={projectSlug}
                                canManage={canManage}
                            />
                        ))}
                    </tbody>
                </table>
            </div>
        </>
    );
}
