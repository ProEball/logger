"use client";
import { t } from "@/core/i18n/t";
import styles from "./AlertRuleEditorTabs.module.scss";

type Tab = "configuration" | "history";

interface AlertRuleEditorTabsProps {
    activeTab: Tab;
    onChange: (tab: Tab) => void;
}

const TABS: { id: Tab; label: string }[] = [
    { id: "configuration", label: t("alerts.editor.tabs.configuration") },
    { id: "history", label: t("alerts.editor.tabs.history") },
];

export function AlertRuleEditorTabs({ activeTab, onChange }: AlertRuleEditorTabsProps) {
    return (
        <div role="tablist" className={styles.tabs}>
            {TABS.map((tab) => (
                <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === tab.id}
                    className={`${styles.tab} ${activeTab === tab.id ? styles.active : ""}`}
                    onClick={() => onChange(tab.id)}
                >
                    {tab.label}
                </button>
            ))}
        </div>
    );
}
