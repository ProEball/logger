"use client";
import { useState } from "react";
import type { WebhookChannel } from "@/features/alerts/utils/alert-schemas";
import styles from "./WebhookChannelForm.module.scss";

interface WebhookChannelFormProps {
    value: WebhookChannel;
    onChange: (channel: WebhookChannel) => void;
    onRemove: () => void;
    canRemove?: boolean;
}

function LinkIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
        </svg>
    );
}

function XIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
    );
}

function SendIcon() {
    return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <line x1="22" y1="2" x2="11" y2="13"/>
            <polygon points="22 2 15 22 11 13 2 9 22 2"/>
        </svg>
    );
}

export function WebhookChannelForm({ value, onChange, onRemove, canRemove = true }: WebhookChannelFormProps) {
    const [showHeaders, setShowHeaders] = useState((value.headers?.length ?? 0) > 0);
    const headers = value.headers ?? [];

    const addHeader = () => {
        setShowHeaders(true);
        onChange({ ...value, headers: [...headers, { key: "", value: "" }] });
    };

    const removeHeader = (i: number) =>
        onChange({ ...value, headers: headers.filter((_, idx) => idx !== i) });

    const updateHeader = (i: number, field: "key" | "value", v: string) => {
        const next = headers.map((h, idx) => (idx === i ? { ...h, [field]: v } : h));
        onChange({ ...value, headers: next });
    };

    const headerCount = headers.length;

    return (
        <div className={styles.card}>
            {/* Card header */}
            <div className={styles.cardHead}>
                <span className={styles.cardIc}><LinkIcon /></span>
                <span className={styles.cardName}>Webhook</span>
                <span className={styles.typePill}>webhook</span>
                {canRemove && (
                    <button type="button" className={styles.removeBtn} onClick={onRemove} title="Remove channel">
                        <XIcon />
                    </button>
                )}
            </div>

            {/* URL + test */}
            <div className={styles.urlRow}>
                <input
                    type="url"
                    className={styles.input}
                    placeholder="https://hooks.slack.com/services/..."
                    value={value.url}
                    onChange={(e) => onChange({ ...value, url: e.target.value })}
                    required
                />
                <button type="button" className={styles.testBtn}>
                    <SendIcon />Test
                </button>
            </div>

            {/* Headers section */}
            <div className={styles.headersSection}>
                <div className={styles.headersLabel}>
                    Headers
                    {headerCount > 0 && (
                        <span className={styles.headerCount}>{headerCount} header{headerCount !== 1 ? "s" : ""}</span>
                    )}
                </div>

                {showHeaders && headers.map((header, i) => (
                    <div key={i} className={styles.headerGrid}>
                        <input
                            type="text"
                            className={`${styles.input} ${styles.monoInput}`}
                            placeholder="Header name"
                            value={header.key}
                            onChange={(e) => updateHeader(i, "key", e.target.value)}
                        />
                        <input
                            type="text"
                            className={`${styles.input} ${styles.monoInput}`}
                            placeholder="Header value"
                            value={header.value}
                            onChange={(e) => updateHeader(i, "value", e.target.value)}
                        />
                        <button type="button" className={styles.rmBtn} onClick={() => removeHeader(i)}>
                            <XIcon />
                        </button>
                    </div>
                ))}

                <button type="button" className={styles.addHeaderBtn} onClick={addHeader}>
                    + Add header
                </button>
            </div>
        </div>
    );
}
