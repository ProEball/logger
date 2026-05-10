"use client";
import { Button } from "@/shared/components/Button/Button";
import { t } from "@/core/i18n/t";
import type { WebhookChannel } from "@/features/alerts/utils/alert-schemas";
import styles from "./WebhookChannelForm.module.scss";

interface WebhookChannelFormProps {
    value: WebhookChannel;
    index: number;
    onChange: (channel: WebhookChannel) => void;
    onRemove: () => void;
}

export function WebhookChannelForm({ value, index, onChange, onRemove }: WebhookChannelFormProps) {
    const headers = value.headers ?? [];

    const updateUrl = (url: string) => onChange({ ...value, url });

    const addHeader = () =>
        onChange({ ...value, headers: [...headers, { key: "", value: "" }] });

    const removeHeader = (i: number) =>
        onChange({ ...value, headers: headers.filter((_, idx) => idx !== i) });

    const updateHeader = (i: number, field: "key" | "value", v: string) => {
        const next = headers.map((h, idx) => (idx === i ? { ...h, [field]: v } : h));
        onChange({ ...value, headers: next });
    };

    return (
        <div className={styles.card}>
            <div className={styles.cardHeader}>
                <span className={styles.cardTitle}>Webhook {index + 1}</span>
                <button type="button" className={styles.removeBtn} onClick={onRemove}>
                    {t("alerts.editor.removeChannel")}
                </button>
            </div>

            <div className={styles.field}>
                <label className={styles.fieldLabel}>{t("alerts.editor.webhookUrl")}</label>
                <input
                    type="url"
                    className={styles.input}
                    placeholder={t("alerts.editor.webhookUrlPlaceholder")}
                    value={value.url}
                    onChange={(e) => updateUrl(e.target.value)}
                    required
                />
            </div>

            {headers.length > 0 && (
                <div className={styles.headers}>
                    {headers.map((header, i) => (
                        <div key={i} className={styles.headerRow}>
                            <input
                                type="text"
                                className={styles.input}
                                placeholder={t("alerts.editor.headerKey")}
                                value={header.key}
                                onChange={(e) => updateHeader(i, "key", e.target.value)}
                            />
                            <input
                                type="text"
                                className={styles.input}
                                placeholder={t("alerts.editor.headerValue")}
                                value={header.value}
                                onChange={(e) => updateHeader(i, "value", e.target.value)}
                            />
                            <button
                                type="button"
                                className={styles.removeBtn}
                                onClick={() => removeHeader(i)}
                            >
                                {t("alerts.editor.removeHeader")}
                            </button>
                        </div>
                    ))}
                </div>
            )}

            <Button type="button" variant="ghost" size="sm" onClick={addHeader}>
                + {t("alerts.editor.addHeader")}
            </Button>
        </div>
    );
}
