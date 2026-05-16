import Link from "next/link";
import { AlertCard } from "@/features/alerts/components/AlertCard/AlertCard";
import type { AlertState } from "@/features/alerts/components/AlertStateBadge/AlertStateBadge";
import type { AlertRule } from "@/core/db/schema";
import type { AlertCondition } from "@/features/alerts/utils/alert-schemas";
import styles from "./AlertsPanel.module.scss";

interface AlertsPanelProps {
    rules: AlertRule[];
    orgSlug: string;
    projectSlug: string;
}

function formatCondition(condition: unknown): string {
    const c = condition as AlertCondition;
    if (!c || typeof c !== "object") return "";
    return `count > ${c.count} / ${c.windowMinutes}min`;
}

function formatLastTriggered(date: Date | null | string | undefined): string | undefined {
    if (!date) return undefined;
    const d = typeof date === "string" ? new Date(date) : date;
    const diff = Date.now() - d.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
}

function ruleState(rule: AlertRule): AlertState {
    if (!rule.enabled) return "disabled";
    return rule.state as AlertState;
}

export function AlertsPanel({ rules, orgSlug, projectSlug }: AlertsPanelProps) {
    const sorted = [...rules].sort((a, b) => {
        const priority = { firing: 0, ok: 1, disabled: 2 };
        return (priority[ruleState(a)] ?? 1) - (priority[ruleState(b)] ?? 1);
    });
    const shown = sorted.slice(0, 6);

    return (
        <section className={styles.panel}>
            <div className={styles.head}>
                <span className={styles.headTitle}>Alerts</span>
                <Link href={`/${orgSlug}/${projectSlug}/alerts`} className={styles.viewAll}>
                    View all
                </Link>
            </div>
            <div className={styles.list}>
                {shown.length === 0 ? (
                    <p className={styles.empty}>No alert rules configured.</p>
                ) : (
                    shown.map((rule) => (
                        <AlertCard
                            key={rule.id}
                            name={rule.name}
                            state={ruleState(rule)}
                            condition={formatCondition(rule.condition)}
                            lastTriggered={formatLastTriggered(rule.stateChangedAt)}
                            channels={(rule.channels as unknown[]).length}
                        />
                    ))
                )}
            </div>
        </section>
    );
}
