"use client";

import { useState } from "react";
import { Popover } from "@/shared/components/Popover/Popover";
import { Button } from "@/shared/components/Button/Button";
import { Input } from "@/shared/components/Input/Input";
import { t } from "@/core/i18n/t";
import type { TranslationKey } from "@/core/i18n/t";
import styles from "./StringListFilter.module.scss";

interface StringListFilterProps {
    labelKey: TranslationKey;
    value: string[];
    onChange: (values: string[]) => void;
}

export function StringListFilter({ labelKey, value, onChange }: StringListFilterProps) {
    const [open, setOpen] = useState(false);
    const [input, setInput] = useState("");

    const label = t(labelKey);

    const handleOpenChange = (next: boolean) => {
        if (next) setInput("");
        setOpen(next);
    };

    const add = () => {
        const trimmed = input.trim();
        if (!trimmed || value.includes(trimmed)) return;
        onChange([...value, trimmed]);
        setInput("");
    };

    const remove = (item: string) => {
        onChange(value.filter((v) => v !== item));
    };

    const handleKey = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
            e.preventDefault();
            add();
        }
    };

    const trigger = (
        <Button variant="ghost" size="sm">
            {label}
        </Button>
    );

    return (
        <Popover
            trigger={trigger}
            open={open}
            onOpenChange={handleOpenChange}
            title={label}
            width={240}
        >
            <div className={styles.content}>
                {value.length > 0 ? (
                    <div className={styles.tags}>
                        {value.map((v) => (
                            <span key={v} className={styles.tag}>
                                {v}
                                <button
                                    type="button"
                                    className={styles.tagRemove}
                                    onClick={() => remove(v)}
                                    aria-label={`Remove ${v}`}
                                >
                                    ×
                                </button>
                            </span>
                        ))}
                    </div>
                ) : null}
                <div className={styles.inputRow}>
                    <Input
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKey}
                        placeholder={label}
                    />
                    <Button size="sm" variant="primary" onClick={add} disabled={!input.trim()}>
                        {t("events.filters.apply")}
                    </Button>
                </div>
            </div>
        </Popover>
    );
}
