"use client";

import { useState } from "react";
import { Popover } from "@/shared/components/Popover/Popover";
import { Button } from "@/shared/components/Button/Button";
import { Input } from "@/shared/components/Input/Input";
import { t } from "@/core/i18n/t";
import type { AttributeFilter as AttributeFilterType } from "@/features/events/utils/event-filters.types";
import styles from "./AttributeFilter.module.scss";

interface AttributeFilterProps {
    onAdd: (attr: AttributeFilterType) => void;
}

export function AttributeFilter({ onAdd }: AttributeFilterProps) {
    const [open, setOpen] = useState(false);
    const [key, setKey] = useState("");
    const [value, setValue] = useState("");

    const handleOpenChange = (next: boolean) => {
        if (next) { setKey(""); setValue(""); }
        setOpen(next);
    };

    const apply = () => {
        if (!key.trim() || !value.trim()) return;
        onAdd({ key: key.trim(), value: value.trim() });
        setOpen(false);
    };

    const handleKey = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") { e.preventDefault(); apply(); }
    };

    const trigger = (
        <Button variant="ghost" size="sm">
            {t("events.filters.attribute")}
        </Button>
    );

    return (
        <Popover
            trigger={trigger}
            open={open}
            onOpenChange={handleOpenChange}
            title={t("events.filters.attribute")}
            width={260}
        >
            <div className={styles.content}>
                <div className={styles.field}>
                    <label className={styles.label}>{t("events.filters.key")}</label>
                    <Input value={key} onChange={(e) => setKey(e.target.value)} onKeyDown={handleKey} placeholder="user_id" />
                </div>
                <div className={styles.field}>
                    <label className={styles.label}>{t("events.filters.value")}</label>
                    <Input value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={handleKey} placeholder="u_123" />
                </div>
                <div className={styles.footer}>
                    <Button size="sm" variant="primary" onClick={apply} disabled={!key.trim() || !value.trim()}>
                        {t("events.filters.apply")}
                    </Button>
                </div>
            </div>
        </Popover>
    );
}
