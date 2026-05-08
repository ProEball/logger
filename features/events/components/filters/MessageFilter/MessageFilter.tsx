"use client";

import { useCallback, useRef } from "react";
import { Input } from "@/shared/components/Input/Input";
import { t } from "@/core/i18n/t";
import styles from "./MessageFilter.module.scss";

interface MessageFilterProps {
    value: string | undefined;
    onChange: (value: string | undefined) => void;
}

export function MessageFilter({ value, onChange }: MessageFilterProps) {
    const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

    const handleChange = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const v = e.target.value;
            clearTimeout(timerRef.current);
            timerRef.current = setTimeout(() => {
                onChange(v || undefined);
            }, 300);
        },
        [onChange],
    );

    return (
        <div className={styles.wrap}>
            <Input
                defaultValue={value ?? ""}
                onChange={handleChange}
                placeholder={t("events.filters.message")}
                aria-label={t("events.filters.message")}
            />
        </div>
    );
}
