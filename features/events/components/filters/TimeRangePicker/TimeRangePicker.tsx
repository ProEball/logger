"use client";

import { useState } from "react";
import { Popover } from "@/shared/components/Popover/Popover";
import { Button } from "@/shared/components/Button/Button";
import { Input } from "@/shared/components/Input/Input";
import { t } from "@/core/i18n/t";
import type { TimeRange, TimeRangePreset } from "@/features/events/utils/event-filters.types";
import styles from "./TimeRangePicker.module.scss";

const DEFAULT_PRESETS: TimeRangePreset[] = ["15m", "1h", "6h", "24h", "7d"];

interface TimeRangePickerProps {
    value: TimeRange;
    onChange: (range: TimeRange) => void;
    /** Override the preset list. Defaults to ["15m","1h","6h","24h","7d"]. */
    presets?: TimeRangePreset[];
}

function formatRangeLabel(range: TimeRange): string {
    if (range.type === "preset") {
        return t(`events.timeRange.${range.value}`);
    }
    const from = new Date(range.from).toLocaleString();
    const to = new Date(range.to).toLocaleString();
    return `${from} – ${to}`;
}

export function TimeRangePicker({ value, onChange, presets = DEFAULT_PRESETS }: TimeRangePickerProps) {
    const [customFrom, setCustomFrom] = useState("");
    const [customTo, setCustomTo] = useState("");
    const [open, setOpen] = useState(false);

    const applyCustom = () => {
        const from = new Date(customFrom);
        const to = new Date(customTo);
        if (isNaN(from.getTime()) || isNaN(to.getTime())) return;
        onChange({ type: "custom", from: from.toISOString(), to: to.toISOString() });
        setOpen(false);
    };

    const trigger = (
        <Button variant="ghost" size="sm">
            {formatRangeLabel(value)}
        </Button>
    );

    return (
        <Popover
            trigger={trigger}
            open={open}
            onOpenChange={setOpen}
            title={t("events.filters.timeRange")}
            width={280}
            placement="bottom-end"
        >
            <div className={styles.presets}>
                {presets.map((preset) => (
                    <button
                        key={preset}
                        type="button"
                        className={`${styles.presetItem} ${value.type === "preset" && value.value === preset ? styles.active : ""}`}
                        onClick={() => {
                            onChange({ type: "preset", value: preset });
                            setOpen(false);
                        }}
                    >
                        {t(`events.timeRange.${preset}`)}
                    </button>
                ))}
            </div>
            <div className={styles.divider} />
            <div className={styles.custom}>
                <div className={styles.customTitle}>{t("events.timeRange.custom")}</div>
                <div className={styles.customField}>
                    <label className={styles.customLabel}>{t("events.timeRange.from")}</label>
                    <Input
                        type="datetime-local"
                        value={customFrom}
                        onChange={(e) => setCustomFrom(e.target.value)}
                    />
                </div>
                <div className={styles.customField}>
                    <label className={styles.customLabel}>{t("events.timeRange.to")}</label>
                    <Input
                        type="datetime-local"
                        value={customTo}
                        onChange={(e) => setCustomTo(e.target.value)}
                    />
                </div>
                <Button
                    variant="primary"
                    onClick={applyCustom}
                    disabled={!customFrom || !customTo}
                >
                    {t("events.filters.apply")}
                </Button>
            </div>
        </Popover>
    );
}
