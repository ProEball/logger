"use client";
import { t } from "@/core/i18n/t";
import type { AlertCondition } from "@/features/alerts/utils/alert-schemas";
import styles from "./ConditionEditor.module.scss";

interface ConditionEditorProps {
    value: AlertCondition;
    onChange: (condition: AlertCondition) => void;
}

export function ConditionEditor({ value, onChange }: ConditionEditorProps) {
    return (
        <div className={styles.wrapper}>
            <p className={styles.label}>{t("alerts.editor.conditionTitle")}</p>
            <div className={styles.row}>
                <span className={styles.text}>{t("alerts.editor.countLabel")}</span>
                <input
                    type="number"
                    className={styles.input}
                    min={1}
                    value={value.count}
                    onChange={(e) => onChange({ ...value, count: Math.max(1, Number(e.target.value)) })}
                />
                <span className={styles.text}>{t("alerts.editor.windowLabel")}</span>
                <input
                    type="number"
                    className={styles.input}
                    min={1}
                    max={1440}
                    value={value.windowMinutes}
                    onChange={(e) => onChange({ ...value, windowMinutes: Math.min(1440, Math.max(1, Number(e.target.value))) })}
                />
                <span className={styles.text}>{t("alerts.editor.minutes")}</span>
            </div>
        </div>
    );
}
