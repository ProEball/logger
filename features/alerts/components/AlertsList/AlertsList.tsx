"use client";
import { useState } from "react";
import Link from "next/link";
import { AlertRow } from "@/features/alerts/components/AlertRow/AlertRow";
import { t } from "@/core/i18n/t";
import type { AlertRule } from "@/core/db/schema";
import styles from "./AlertsList.module.scss";

interface AlertsListProps {
    rules: AlertRule[];
    allRules: AlertRule[];
    orgSlug: string;
    projectSlug: string;
    canManage: boolean;
}

export function AlertsList({ rules, allRules, orgSlug, projectSlug, canManage }: AlertsListProps) {
    const [showDisabled, setShowDisabled] = useState(false);

    const disabledCount = allRules.filter((r) => !r.enabled).length;
    const displayed = showDisabled ? allRules : rules;

    if (displayed.length === 0) {
        return (
            <div className={styles.empty}>
                <p>{showDisabled ? t("alerts.list.noDisabled") : t("alerts.empty")}</p>
                {canManage && !showDisabled && (
                    <Link href={`/${orgSlug}/${projectSlug}/alerts/new`} className={styles.createBtn}>
                        {t("alerts.actions.create")}
                    </Link>
                )}
            </div>
        );
    }

    return (
        <div className={styles.container}>
            <div className={styles.toolbar}>
                {disabledCount > 0 && (
                    <label className={styles.toggle}>
                        <input
                            type="checkbox"
                            checked={showDisabled}
                            onChange={(e) => setShowDisabled(e.target.checked)}
                        />
                        {t("alerts.list.showDisabled")} ({disabledCount})
                    </label>
                )}
                {canManage && (
                    <Link href={`/${orgSlug}/${projectSlug}/alerts/new`} className={styles.createBtn}>
                        {t("alerts.actions.create")}
                    </Link>
                )}
            </div>

            <table className={styles.table}>
                <thead>
                    <tr>
                        <th>Name</th>
                        <th>State</th>
                        <th>{t("alerts.list.lastTriggered")}</th>
                        <th>{t("alerts.list.channels")}</th>
                        {canManage && <th />}
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
    );
}
