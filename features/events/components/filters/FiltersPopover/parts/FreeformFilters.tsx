"use client";

import { useState } from "react";
import type { KeyboardEvent } from "react";
import { Input } from "@/shared/components/Input/Input";
import { Button } from "@/shared/components/Button/Button";
import { t } from "@/core/i18n/t";
import type { AttributeFilter } from "@/features/events/utils/event-filters.types";
import styles from "../FiltersPopover.module.scss";

type CorrelationKey = "userId" | "sessionId" | "requestId" | "traceId";

interface FreeformFiltersProps {
    message: string;
    onMessageChange: (value: string) => void;
    correlation: Record<CorrelationKey, string>;
    onCorrelationChange: (key: CorrelationKey, value: string) => void;
    attributes: AttributeFilter[];
    onAddAttribute: (attr: AttributeFilter) => void;
    onRemoveAttribute: (key: string) => void;
}

const CORRELATION_FIELDS: { key: CorrelationKey; labelKey: Parameters<typeof t>[0] }[] = [
    { key: "userId", labelKey: "events.filters.userId" },
    { key: "sessionId", labelKey: "events.filters.sessionId" },
    { key: "requestId", labelKey: "events.filters.requestId" },
    { key: "traceId", labelKey: "events.filters.traceId" },
];

export function FreeformFilters({
    message,
    onMessageChange,
    correlation,
    onCorrelationChange,
    attributes,
    onAddAttribute,
    onRemoveAttribute,
}: FreeformFiltersProps) {
    const [attrKey, setAttrKey] = useState("");
    const [attrValue, setAttrValue] = useState("");

    const addAttr = () => {
        if (!attrKey.trim() || !attrValue.trim()) return;
        onAddAttribute({ key: attrKey.trim(), value: attrValue.trim() });
        setAttrKey("");
        setAttrValue("");
    };

    const handleAttrKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Enter") {
            e.preventDefault();
            addAttr();
        }
    };

    return (
        <div className={styles.freeformRow}>
            <div className={styles.freeformGroup}>
                <div className={styles.facetTitle}>{t("events.filters.message")}</div>
                <Input
                    value={message}
                    onChange={(e) => onMessageChange(e.target.value)}
                    placeholder={t("events.filters.message")}
                />
            </div>

            <div className={styles.freeformGroup}>
                <div className={styles.facetTitle}>{t("events.filters.correlation")}</div>
                <div className={styles.correlationGrid}>
                    {CORRELATION_FIELDS.map(({ key, labelKey }) => (
                        <Input
                            key={key}
                            value={correlation[key]}
                            onChange={(e) => onCorrelationChange(key, e.target.value)}
                            placeholder={t(labelKey)}
                        />
                    ))}
                </div>
            </div>

            <div className={styles.freeformGroup}>
                <div className={styles.facetTitle}>{t("events.filters.attribute")}</div>
                <div className={styles.attrAddRow}>
                    <Input
                        value={attrKey}
                        onChange={(e) => setAttrKey(e.target.value)}
                        onKeyDown={handleAttrKeyDown}
                        placeholder={t("events.filters.key")}
                    />
                    <Input
                        value={attrValue}
                        onChange={(e) => setAttrValue(e.target.value)}
                        onKeyDown={handleAttrKeyDown}
                        placeholder={t("events.filters.value")}
                    />
                    <Button size="sm" variant="secondary" onClick={addAttr} disabled={!attrKey.trim() || !attrValue.trim()}>
                        +
                    </Button>
                </div>
                {attributes.length > 0 ? (
                    <div className={styles.attrList}>
                        {attributes.map((attr) => (
                            <span key={attr.key} className={styles.attrTag}>
                                {attr.key}={attr.value}
                                <button
                                    type="button"
                                    className={styles.attrRemove}
                                    onClick={() => onRemoveAttribute(attr.key)}
                                    aria-label={`Remove ${attr.key}`}
                                >
                                    ×
                                </button>
                            </span>
                        ))}
                    </div>
                ) : null}
            </div>
        </div>
    );
}
