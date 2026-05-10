"use client";
import { useTransition } from "react";
import Link from "next/link";
import { Switch } from "@/shared/components/Switch/Switch";
import { AlertStateBadge } from "@/features/alerts/components/AlertStateBadge/AlertStateBadge";
import { toggleAlertRuleAction } from "@/features/alerts/actions/toggle-alert-rule.action";
import { deleteAlertRuleAction } from "@/features/alerts/actions/delete-alert-rule.action";
import { testAlertRuleAction } from "@/features/alerts/actions/test-alert-rule.action";
import { t } from "@/core/i18n/t";
import type { AlertRule } from "@/core/db/schema";
import type { AlertState } from "@/features/alerts/components/AlertStateBadge/AlertStateBadge";
import styles from "./AlertRow.module.scss";

interface AlertRowProps {
    rule: AlertRule;
    orgSlug: string;
    projectSlug: string;
    canManage: boolean;
}

function formatLastTriggered(date: Date | null | string | undefined): string {
    if (!date) return t("alerts.list.never");
    const d = typeof date === "string" ? new Date(date) : date;
    return new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(
        Math.round((d.getTime() - Date.now()) / 60000),
        "minute",
    );
}

export function AlertRow({ rule, orgSlug, projectSlug, canManage }: AlertRowProps) {
    const [isPending, startTransition] = useTransition();

    const displayState: AlertState = !rule.enabled
        ? "disabled"
        : (rule.state as AlertState);

    const channels = rule.channels as Array<{ type: string; url: string }>;
    const channelSummary = `${channels.length} webhook${channels.length !== 1 ? "s" : ""}`;

    const handleToggle = () => {
        startTransition(async () => {
            await toggleAlertRuleAction(orgSlug, projectSlug, rule.id, !rule.enabled);
        });
    };

    const handleDelete = () => {
        if (!confirm(t("alerts.actions.confirmDelete"))) return;
        startTransition(async () => {
            await deleteAlertRuleAction(orgSlug, projectSlug, rule.id);
        });
    };

    const handleTestFire = () => {
        startTransition(async () => {
            const result = await testAlertRuleAction(orgSlug, projectSlug, rule.id);
            if ("ok" in result) {
                alert(t("alerts.testFire.success").replace("{{status}}", String(result.httpStatus)));
            } else {
                alert(t("alerts.testFire.error").replace("{{error}}", result.error));
            }
        });
    };

    return (
        <tr className={styles.row}>
            <td className={styles.name}>
                <Link href={`/${orgSlug}/${projectSlug}/alerts/${rule.id}`} className={styles.nameLink}>
                    {rule.name}
                </Link>
                {rule.description && (
                    <span className={styles.description}>{rule.description}</span>
                )}
            </td>
            <td><AlertStateBadge state={displayState} /></td>
            <td className={styles.meta}>{formatLastTriggered(rule.stateChangedAt)}</td>
            <td className={styles.meta}>{channelSummary}</td>
            {canManage && (
                <td className={styles.actions}>
                    <Switch
                        checked={rule.enabled}
                        onChange={handleToggle}
                        disabled={isPending}
                        aria-label={rule.enabled ? t("alerts.actions.disable") : t("alerts.actions.enable")}
                    />
                    <Link
                        href={`/${orgSlug}/${projectSlug}/alerts/${rule.id}`}
                        className={styles.actionBtn}
                    >
                        {t("alerts.actions.edit")}
                    </Link>
                    <button
                        type="button"
                        className={styles.actionBtn}
                        onClick={handleTestFire}
                        disabled={isPending}
                    >
                        {t("alerts.actions.testFire")}
                    </button>
                    <button
                        type="button"
                        className={`${styles.actionBtn} ${styles.danger}`}
                        onClick={handleDelete}
                        disabled={isPending}
                    >
                        {t("alerts.actions.delete")}
                    </button>
                </td>
            )}
        </tr>
    );
}
