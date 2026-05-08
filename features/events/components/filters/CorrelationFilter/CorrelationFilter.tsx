"use client";

import { useState } from "react";
import { Popover } from "@/shared/components/Popover/Popover";
import { Button } from "@/shared/components/Button/Button";
import { Input } from "@/shared/components/Input/Input";
import { t } from "@/core/i18n/t";
import styles from "./CorrelationFilter.module.scss";

type CorrelationKey = "userId" | "sessionId" | "requestId" | "traceId";

interface CorrelationFilterProps {
    userId?: string;
    sessionId?: string;
    requestId?: string;
    traceId?: string;
    onChange: (key: CorrelationKey, value: string | undefined) => void;
}

const FIELDS: { key: CorrelationKey; labelKey: Parameters<typeof t>[0] }[] = [
    { key: "userId", labelKey: "events.filters.userId" },
    { key: "sessionId", labelKey: "events.filters.sessionId" },
    { key: "requestId", labelKey: "events.filters.requestId" },
    { key: "traceId", labelKey: "events.filters.traceId" },
];

export function CorrelationFilter({ userId, sessionId, requestId, traceId, onChange }: CorrelationFilterProps) {
    const [open, setOpen] = useState(false);
    const [drafts, setDrafts] = useState({ userId: userId ?? "", sessionId: sessionId ?? "", requestId: requestId ?? "", traceId: traceId ?? "" });

    const handleOpenChange = (next: boolean) => {
        if (next) {
            setDrafts({ userId: userId ?? "", sessionId: sessionId ?? "", requestId: requestId ?? "", traceId: traceId ?? "" });
        }
        setOpen(next);
    };

    const apply = () => {
        for (const field of FIELDS) {
            const val = drafts[field.key].trim() || undefined;
            onChange(field.key, val);
        }
        setOpen(false);
    };

    const trigger = (
        <Button variant="ghost" size="sm">
            {t("events.filters.correlation")}
        </Button>
    );

    return (
        <Popover
            trigger={trigger}
            open={open}
            onOpenChange={handleOpenChange}
            title={t("events.filters.correlation")}
            width={280}
        >
            <div className={styles.content}>
                {FIELDS.map(({ key, labelKey }) => (
                    <div key={key} className={styles.field}>
                        <label className={styles.label}>{t(labelKey)}</label>
                        <Input
                            value={drafts[key]}
                            onChange={(e) => setDrafts((prev) => ({ ...prev, [key]: e.target.value }))}
                            placeholder={t(labelKey)}
                        />
                    </div>
                ))}
                <div className={styles.footer}>
                    <Button size="sm" variant="primary" onClick={apply}>
                        {t("events.filters.apply")}
                    </Button>
                </div>
            </div>
        </Popover>
    );
}
